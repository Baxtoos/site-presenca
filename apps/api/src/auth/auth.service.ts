import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  type AcceptedResponse,
  AuthErrorCode,
  type LoginBody,
  type MeResponse,
  type RegisterBody,
  type ResetPasswordBody,
} from "@presenca/contracts";
import { newId, schema, type Tx } from "@presenca/db";
import { magicLinkMessage, resetPasswordMessage, verifyEmailMessage } from "@presenca/emails";
import { eq, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { BackgroundTasks } from "../common/background-tasks";
import { ENV, type Env } from "../config/env";
import { DbService } from "../database/db.service";
import { MAILER, type Mailer } from "../mail/mailer";
import { AuthRepository, type TokenPurpose } from "./auth.repository";
import type { GoogleProfile } from "./google.provider";
import { PasswordService } from "./password.service";
import { SessionService } from "./session.service";
import { generateToken, hashToken } from "./tokens";
import { isUniqueViolation, nameFromEmail, toMe } from "./user-mapper";

const MINUTE = 60;
const TTL: Record<TokenPurpose, number> = {
  verify_email: 24 * 60 * MINUTE,
  reset_password: 15 * MINUTE,
  magic_link: 15 * MINUTE,
};

const ACCEPTED: AcceptedResponse = { status: "accepted" };

const invalidToken = () =>
  new BadRequestException({
    code: AuthErrorCode.invalidToken,
    detail: "Este link é inválido, já foi usado ou expirou. Peça um novo.",
  });

const accountDisabled = () =>
  new ForbiddenException({
    code: AuthErrorCode.accountDisabled,
    detail: "Esta conta está desativada.",
  });

/** Erro do login com Google que vira um redirecionamento com ?erro=<code> para o app. */
export class GoogleLoginError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tasks: BackgroundTasks,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------- cadastro e login

  async register(
    body: RegisterBody,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    await this.rejectBreachedPassword(body.password);
    const passwordHash = await this.passwords.hash(body.password);
    const userId = newId();
    await this.sessions.revokePresented(request);

    let result: { token: string; user: typeof schema.users.$inferSelect };
    try {
      result = await this.db.asUser(userId, async (tx) => {
        const [user] = await tx
          .insert(schema.users)
          .values({ id: userId, email: body.email, fullName: body.fullName, passwordHash })
          .returning();
        await tx.insert(schema.notificationPreferences).values({ userId });
        const token = await this.sessions.createInTx(tx, userId, request);
        return { token, user: user! };
      });
    } catch (error) {
      if (isUniqueViolation(error, "users_email_key")) {
        throw new ConflictException({
          code: AuthErrorCode.emailTaken,
          detail: "Já existe uma conta com este e-mail. Entre ou recupere a senha.",
        });
      }
      throw error;
    }

    this.sessions.setCookie(reply, result.token);
    this.tasks.run("verificação de e-mail", () =>
      this.sendVerification(userId, body.email, body.fullName),
    );
    this.logger.log(`conta criada ${userId}`);
    return toMe(result.user);
  }

  async login(body: LoginBody, request: FastifyRequest, reply: FastifyReply): Promise<MeResponse> {
    const credentials = await this.repo.findUserByEmail(body.email);
    // Sempre roda o Argon2 (contra um hash falso se a conta não existir): mesmo tempo de resposta.
    const ok = await this.passwords.verify(credentials?.passwordHash ?? null, body.password);
    if (!credentials || !ok) {
      this.logger.warn("login recusado: credenciais inválidas");
      throw new UnauthorizedException({
        code: AuthErrorCode.invalidCredentials,
        detail: "E-mail ou senha incorretos.",
      });
    }
    if (credentials.status !== "active") throw accountDisabled();
    return this.openSession(credentials.userId, request, reply);
  }

  async logout(userId: string, sessionId: string, reply: FastifyReply): Promise<void> {
    await this.sessions.revoke(userId, sessionId);
    this.sessions.clearCookie(reply);
  }

  // ---------------------------------------------------------------- magic link

  /** Sempre aceita. O trabalho (token e e-mail) roda depois da resposta: o tempo não revela nada. */
  async requestMagicLink(email: string): Promise<AcceptedResponse> {
    this.tasks.run("magic link", async () => {
      const credentials = await this.repo.findUserByEmail(email);
      if (credentials && credentials.status !== "active") return;
      const token = await this.issue(credentials?.userId ?? null, email, "magic_link");
      await this.mailer.send({
        to: email,
        ...magicLinkMessage({ url: this.link("/entrar/link", token), newAccount: !credentials }),
      });
    });
    return ACCEPTED;
  }

  async consumeMagicLink(
    token: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    const consumed = await this.repo.consumeToken(hashToken(token), "magic_link");
    if (!consumed) throw invalidToken();

    // A conta pode ter sido criada entre o envio e o clique: sempre procura pelo e-mail.
    const existing = await this.repo.findUserByEmail(consumed.email);
    if (existing && existing.status !== "active") throw accountDisabled();
    await this.sessions.revokePresented(request);

    if (existing) {
      // Clicar no link prova a posse do e-mail.
      await this.db.asUser(existing.userId, (tx) => this.markEmailVerified(tx, existing.userId));
      return this.openSession(existing.userId, request, reply);
    }
    return this.createPasswordlessAccount(
      { email: consumed.email, fullName: nameFromEmail(consumed.email) },
      request,
      reply,
    );
  }

  // ---------------------------------------------------------------- verificação de e-mail

  async verifyEmail(token: string): Promise<void> {
    const consumed = await this.repo.consumeToken(hashToken(token), "verify_email");
    if (!consumed?.userId) throw invalidToken();
    const userId = consumed.userId;
    await this.db.asUser(userId, (tx) => this.markEmailVerified(tx, userId));
  }

  async resendVerification(userId: string, alreadyVerified: boolean): Promise<AcceptedResponse> {
    if (alreadyVerified) return ACCEPTED;
    const user = await this.db.asUser(userId, (tx) =>
      tx.query.users.findFirst({ columns: { email: true, fullName: true } }),
    );
    if (user) {
      this.tasks.run("reenvio de verificação", () =>
        this.sendVerification(userId, user.email, user.fullName),
      );
    }
    return ACCEPTED;
  }

  // ---------------------------------------------------------------- senha

  /** Sempre aceita, exista ou não a conta. O envio roda depois da resposta. */
  async forgotPassword(email: string): Promise<AcceptedResponse> {
    this.tasks.run("redefinição de senha", async () => {
      const credentials = await this.repo.findUserByEmail(email);
      if (!credentials || credentials.status !== "active") return;
      const token = await this.issue(credentials.userId, email, "reset_password");
      await this.mailer.send({
        to: email,
        ...resetPasswordMessage({ url: this.link("/redefinir-senha", token) }),
      });
    });
    return ACCEPTED;
  }

  async resetPassword(
    body: ResetPasswordBody,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    // Valida a senha antes de consumir o link: uma senha recusada não queima o link.
    await this.rejectBreachedPassword(body.password);
    const passwordHash = await this.passwords.hash(body.password);

    const consumed = await this.repo.consumeToken(hashToken(body.token), "reset_password");
    if (!consumed?.userId) throw invalidToken();
    const credentials = await this.repo.findUserByEmail(consumed.email);
    if (!credentials || credentials.userId !== consumed.userId) throw invalidToken();
    if (credentials.status !== "active") throw accountDisabled();
    const userId = consumed.userId;

    const { token, user } = await this.db.asUser(userId, async (tx) => {
      const [user] = await tx
        .update(schema.users)
        .set({
          passwordHash,
          emailVerifiedAt: sql`coalesce(${schema.users.emailVerifiedAt}, now())`,
        })
        .where(eq(schema.users.id, userId))
        .returning();
      // Trocar a senha encerra todas as sessões (inclusive de quem a tenha roubado).
      await this.sessions.revokeAllInTx(tx, userId);
      const token = await this.sessions.createInTx(tx, userId, request);
      return { token, user: user! };
    });
    this.sessions.setCookie(reply, token);
    this.logger.log(`senha redefinida ${userId}; todas as sessões anteriores encerradas`);
    return toMe(user);
  }

  // ---------------------------------------------------------------- Google

  async loginWithGoogle(
    profile: GoogleProfile,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!profile.emailVerified) throw new GoogleLoginError("google_email_nao_verificado");

    let userId = await this.repo.findAccount("google", profile.sub);
    if (!userId) {
      const existing = await this.repo.findUserByEmail(profile.email);
      if (existing) {
        // Só vincula a uma conta que já provou ser dona do e-mail; senão alguém que criasse uma
        // conta com o e-mail de outra pessoa ganharia acesso quando ela entrasse com o Google.
        if (!existing.emailVerified) throw new GoogleLoginError("conta_nao_verificada");
        if (existing.status !== "active") throw new GoogleLoginError("conta_desativada");
        const linkedUserId = existing.userId;
        await this.db.asUser(linkedUserId, (tx) =>
          tx.insert(schema.authAccounts).values({
            userId: linkedUserId,
            provider: "google",
            providerAccountId: profile.sub,
            email: profile.email,
          }),
        );
        userId = linkedUserId;
      } else {
        await this.sessions.revokePresented(request);
        await this.createPasswordlessAccount(
          {
            email: profile.email,
            fullName: profile.name?.trim() || nameFromEmail(profile.email),
            google: { sub: profile.sub },
          },
          request,
          reply,
        );
        return;
      }
    }

    const confirmedUserId = userId;
    const status = await this.db.asUser(confirmedUserId, (tx) =>
      tx.query.users.findFirst({ columns: { status: true } }),
    );
    if (status?.status !== "active") throw new GoogleLoginError("conta_desativada");
    await this.sessions.revokePresented(request);
    await this.openSession(confirmedUserId, request, reply);
  }

  // ---------------------------------------------------------------- internos

  private async openSession(
    userId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    const { token, user } = await this.db.asUser(userId, async (tx) => {
      const user = await tx.query.users.findFirst();
      const token = await this.sessions.createInTx(tx, userId, request);
      return { token, user: user! };
    });
    this.sessions.setCookie(reply, token);
    return toMe(user);
  }

  /** Conta sem senha (magic link ou Google): o e-mail já chega verificado. */
  private async createPasswordlessAccount(
    params: { email: string; fullName: string; google?: { sub: string } },
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse> {
    const userId = newId();
    const { token, user } = await this.db.asUser(userId, async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          id: userId,
          email: params.email,
          fullName: params.fullName,
          emailVerifiedAt: new Date(),
        })
        .returning();
      await tx.insert(schema.notificationPreferences).values({ userId });
      if (params.google) {
        await tx.insert(schema.authAccounts).values({
          userId,
          provider: "google",
          providerAccountId: params.google.sub,
          email: params.email,
        });
      }
      const token = await this.sessions.createInTx(tx, userId, request);
      return { token, user: user! };
    });
    this.sessions.setCookie(reply, token);
    this.logger.log(`conta criada sem senha ${userId}`);
    return toMe(user);
  }

  private async markEmailVerified(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(schema.users)
      .set({ emailVerifiedAt: sql`coalesce(${schema.users.emailVerifiedAt}, now())` })
      .where(eq(schema.users.id, userId));
  }

  private async sendVerification(userId: string, email: string, name: string): Promise<void> {
    const token = await this.issue(userId, email, "verify_email");
    await this.mailer.send({
      to: email,
      ...verifyEmailMessage({ name, url: this.link("/verificar-email", token) }),
    });
  }

  private async issue(
    userId: string | null,
    email: string,
    purpose: TokenPurpose,
  ): Promise<string> {
    const token = generateToken();
    await this.repo.issueToken({
      userId,
      email,
      purpose,
      tokenHash: hashToken(token),
      ttlSeconds: TTL[purpose],
    });
    return token;
  }

  private link(path: string, token: string): string {
    const url = new URL(path, this.env.WEB_ORIGIN);
    url.searchParams.set("token", token);
    return url.toString();
  }

  private async rejectBreachedPassword(password: string): Promise<void> {
    if (await this.passwords.isBreached(password)) {
      throw new UnprocessableEntityException({
        code: AuthErrorCode.passwordBreached,
        errors: [
          {
            path: "password",
            message: "Esta senha aparece em vazamentos de dados conhecidos. Escolha outra.",
          },
        ],
      });
    }
  }
}
