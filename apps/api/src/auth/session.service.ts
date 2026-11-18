import { Injectable } from "@nestjs/common";
import { schema, type Tx } from "@presenca/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DbService } from "../database/db.service";
import { AuthRepository, type ResolvedSession } from "./auth.repository";
import { generateToken, hashToken, TOKEN_FORMAT } from "./tokens";

/** __Host-: o navegador só aceita com Secure, Path=/ e sem Domain (não vaza para subdomínios). */
export const SESSION_COOKIE = "__Host-sid";

const DAY = 86_400_000;
/** Validade renovada a cada uso. */
const SLIDING_MS = 30 * DAY;
/** Sessão parada há mais tempo que isso deixa de valer, mesmo antes de expirar. */
const IDLE_MS = 14 * DAY;
/** Teto absoluto: depois disso, login de novo, mesmo com uso contínuo. */
const ABSOLUTE_MS = 90 * DAY;
/** Só grava last_seen_at se a última atualização tiver mais de 1 h (evita escrita a cada requisição). */
const TOUCH_MS = 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    private readonly repo: AuthRepository,
  ) {}

  /** Cria a sessão dentro de uma transação já aberta como o usuário. Devolve o token do cookie. */
  async createInTx(tx: Tx, userId: string, request: FastifyRequest): Promise<string> {
    const token = generateToken();
    const now = Date.now();
    await tx.insert(schema.sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + SLIDING_MS),
      ip: request.clientIp,
      userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null,
    });
    return token;
  }

  /**
   * Encerra a sessão que veio no cookie, se houver (troca de conta no mesmo navegador, ou
   * login novo por cima de um antigo). Evita sessões órfãs e fixação de sessão.
   */
  async revokePresented(request: FastifyRequest): Promise<void> {
    const current = await this.resolve(request.cookies[SESSION_COOKIE]);
    if (current) await this.revoke(current.userId, current.sessionId);
  }

  /** Resolve o token do cookie numa sessão válida (não revogada, não expirada, não ociosa). */
  async resolve(token: string | undefined): Promise<ResolvedSession | undefined> {
    if (!token || !TOKEN_FORMAT.test(token)) return undefined;
    const session = await this.repo.resolveSession(hashToken(token));
    if (!session) return undefined;
    const now = Date.now();
    if (now - session.lastSeenAt.getTime() > IDLE_MS) return undefined;
    if (now - session.createdAt.getTime() > ABSOLUTE_MS) return undefined;
    return session;
  }

  /** Renova a validade (deslizante, com teto absoluto) e o cookie, no máximo uma vez por hora. */
  async touch(session: ResolvedSession, reply: FastifyReply, token: string): Promise<void> {
    if (Date.now() - session.lastSeenAt.getTime() < TOUCH_MS) return;
    const absoluteEnd = session.createdAt.getTime() + ABSOLUTE_MS;
    const expiresAt = new Date(Math.min(Date.now() + SLIDING_MS, absoluteEnd));
    await this.db.asUser(session.userId, (tx) =>
      tx
        .update(schema.sessions)
        .set({ lastSeenAt: sql`now()`, expiresAt })
        .where(eq(schema.sessions.id, session.sessionId)),
    );
    this.setCookie(reply, token, expiresAt);
  }

  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const rows = await this.db.asUser(userId, (tx) =>
      tx
        .update(schema.sessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
        .returning({ id: schema.sessions.id }),
    );
    return rows.length > 0;
  }

  /** Encerra todas as sessões do usuário (troca de senha). */
  async revokeAllInTx(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(schema.sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  }

  setCookie(reply: FastifyReply, token: string, expiresAt = new Date(Date.now() + SLIDING_MS)) {
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }

  clearCookie(reply: FastifyReply) {
    void reply.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }
}
