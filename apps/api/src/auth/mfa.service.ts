import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthErrorCode, type MfaSetupResponse, type MfaStatusResponse } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { randomInt } from "node:crypto";
import { ClockService } from "../common/clock";
import { ENV, type Env } from "../config/env";
import { DbService } from "../database/db.service";
import { REDIS } from "../redis/redis.module";
import { decryptSecret, encryptSecret } from "./mfa-crypto";
import { generateToken, hashToken, TOKEN_FORMAT } from "./tokens";
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";

/** Desafio do login com segundo fator: cookie próprio, separado da sessão. */
export const MFA_COOKIE = "__Host-mfa";
const CHALLENGE_SECONDS = 5 * 60;
/** Tentativas de código por desafio; depois, login de novo. */
const CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODES = 10;
/** Sem 0/O e 1/I/L: fácil de ler e digitar. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const invalidCode = () =>
  new BadRequestException({
    code: AuthErrorCode.mfaInvalidCode,
    detail: "Código incorreto. Confira o app autenticador e tente de novo.",
  });

const challengeExpired = () =>
  new BadRequestException({
    code: AuthErrorCode.mfaChallengeExpired,
    detail: "A verificação expirou. Entre de novo.",
  });

/**
 * Segundo fator opcional (TOTP). O segredo fica cifrado no banco; no login, quem tem o segundo
 * fator ligado recebe um desafio (cookie de 5 minutos) em vez da sessão, e a sessão só abre com
 * um código do app ou um código de recuperação.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly key: Buffer | null;

  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.key = env.MFA_ENCRYPTION_KEY ? Buffer.from(env.MFA_ENCRYPTION_KEY, "base64") : null;
  }

  get available(): boolean {
    return this.key !== null;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.db.asUser(userId, (tx) =>
      tx.query.userMfa.findFirst({ columns: { enabledAt: true } }),
    );
    return Boolean(row?.enabledAt);
  }

  async status(userId: string): Promise<MfaStatusResponse> {
    return this.db.asUser(userId, async (tx) => {
      const row = await tx.query.userMfa.findFirst({ columns: { enabledAt: true } });
      const [left] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.mfaRecoveryCodes)
        .where(isNull(schema.mfaRecoveryCodes.usedAt));
      return {
        available: this.available,
        enabled: Boolean(row?.enabledAt),
        recoveryCodesLeft: row?.enabledAt ? (left?.n ?? 0) : 0,
      };
    });
  }

  // ---------------------------------------------------------------- ativação

  /** Gera um segredo novo (pendente até ser confirmado com um código). */
  async setup(userId: string, email: string): Promise<MfaSetupResponse> {
    const key = this.requireKey();
    const secret = generateTotpSecret();
    await this.db.asUser(userId, async (tx) => {
      const current = await tx.query.userMfa.findFirst({ columns: { enabledAt: true } });
      if (current?.enabledAt) {
        throw new ConflictException({
          code: "MFA_ALREADY_ENABLED",
          detail: "O segundo fator já está ligado.",
        });
      }
      const values = { userId, secretCiphertext: encryptSecret(key, userId, secret) };
      await tx
        .insert(schema.userMfa)
        .values(values)
        .onConflictDoUpdate({
          target: schema.userMfa.userId,
          set: { secretCiphertext: values.secretCiphertext, lastUsedStep: null },
        });
    });
    return { secret: base32Encode(secret), otpauthUrl: otpauthUrl(secret, email) };
  }

  /** Confirma com o primeiro código do app: liga e devolve os códigos de recuperação. */
  async enable(userId: string, code: string): Promise<string[]> {
    const key = this.requireKey();
    return this.db.asUser(userId, async (tx) => {
      const row = await tx.query.userMfa.findFirst();
      if (!row || row.enabledAt) throw invalidCode();
      const step = verifyTotp(
        decryptSecret(key, userId, row.secretCiphertext),
        code.replace(/\s/g, ""),
        this.clock.now().getTime(),
        row.lastUsedStep,
      );
      if (step === null) throw invalidCode();
      await tx
        .update(schema.userMfa)
        .set({ enabledAt: sql`now()`, lastUsedStep: step })
        .where(eq(schema.userMfa.userId, userId));
      this.logger.log(`segundo fator ligado ${userId}`);
      return this.replaceRecoveryCodes(tx, userId);
    });
  }

  /** Desliga (pede um código do app ou de recuperação). */
  async disable(userId: string, code: string): Promise<void> {
    await this.db.asUser(userId, async (tx) => {
      if (!(await this.checkFactor(tx, userId, code))) throw invalidCode();
      await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
      await tx.delete(schema.userMfa).where(eq(schema.userMfa.userId, userId));
    });
    this.logger.log(`segundo fator desligado ${userId}`);
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
    return this.db.asUser(userId, async (tx) => {
      if (!(await this.checkFactor(tx, userId, code))) throw invalidCode();
      return this.replaceRecoveryCodes(tx, userId);
    });
  }

  // ---------------------------------------------------------------- login

  /** Login com segundo fator: guarda o desafio no Redis e manda o cookie (em vez da sessão). */
  async startChallenge(userId: string, reply: FastifyReply): Promise<void> {
    const token = generateToken();
    await this.redis.set(this.challengeKey(token), userId, "EX", CHALLENGE_SECONDS);
    void reply.setCookie(MFA_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: CHALLENGE_SECONDS,
    });
  }

  /**
   * Confere o código do desafio. Devolve o usuário (a sessão é aberta por quem chamou).
   * Cinco erros encerram o desafio; um acerto também (uso único).
   */
  async completeChallenge(
    request: FastifyRequest,
    reply: FastifyReply,
    code: string,
  ): Promise<string> {
    const token = request.cookies[MFA_COOKIE];
    if (!token || !TOKEN_FORMAT.test(token)) throw challengeExpired();
    const key = this.challengeKey(token);
    const userId = await this.redis.get(key);
    if (!userId) {
      this.clearChallengeCookie(reply);
      throw challengeExpired();
    }

    const ok = await this.db.asUser(userId, (tx) => this.checkFactor(tx, userId, code));
    if (!ok) {
      const attempts = await this.redis.incr(`${key}:tentativas`);
      if (attempts === 1) await this.redis.expire(`${key}:tentativas`, CHALLENGE_SECONDS);
      if (attempts >= CHALLENGE_ATTEMPTS) {
        await this.redis.del(key, `${key}:tentativas`);
        this.clearChallengeCookie(reply);
        throw challengeExpired();
      }
      throw invalidCode();
    }
    await this.redis.del(key, `${key}:tentativas`);
    this.clearChallengeCookie(reply);
    return userId;
  }

  // ---------------------------------------------------------------- internos

  /** Código do app (6 dígitos, uma vez só) ou de recuperação (uso único). */
  private async checkFactor(tx: Tx, userId: string, raw: string): Promise<boolean> {
    const row = await tx.query.userMfa.findFirst();
    if (!row?.enabledAt) return false;
    const code = raw.replace(/[\s-]/g, "").toUpperCase();

    if (/^\d{6}$/.test(code)) {
      if (!this.key) return false;
      const step = verifyTotp(
        decryptSecret(this.key, userId, row.secretCiphertext),
        code,
        this.clock.now().getTime(),
        row.lastUsedStep,
      );
      if (step === null) return false;
      // Condição no UPDATE: dois pedidos com o mesmo código ao mesmo tempo, só um passa.
      const updated = await tx
        .update(schema.userMfa)
        .set({ lastUsedStep: step })
        .where(
          and(
            eq(schema.userMfa.userId, userId),
            sql`coalesce(${schema.userMfa.lastUsedStep}, -1) < ${step}`,
          ),
        )
        .returning({ userId: schema.userMfa.userId });
      return updated.length === 1;
    }

    if (code.length !== 8) return false;
    const used = await tx
      .update(schema.mfaRecoveryCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(schema.mfaRecoveryCodes.userId, userId),
          eq(schema.mfaRecoveryCodes.codeHash, hashToken(code)),
          isNull(schema.mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: schema.mfaRecoveryCodes.id });
    if (used.length === 1) this.logger.log(`código de recuperação usado ${userId}`);
    return used.length === 1;
  }

  private async replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODES }, () => {
      const chars = Array.from(
        { length: 8 },
        () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
      );
      return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
    });
    await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
    await tx
      .insert(schema.mfaRecoveryCodes)
      .values(codes.map((c) => ({ userId, codeHash: hashToken(c.replace("-", "")) })));
    return codes;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException({
        code: AuthErrorCode.mfaUnavailable,
        detail: "O segundo fator ainda não está disponível neste servidor.",
      });
    }
    return this.key;
  }

  private challengeKey(token: string): string {
    return `mfa:desafio:${hashToken(token).toString("hex")}`;
  }

  private clearChallengeCookie(reply: FastifyReply) {
    void reply.clearCookie(MFA_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }
}
