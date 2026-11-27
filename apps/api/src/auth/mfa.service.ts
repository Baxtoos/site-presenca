import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
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

export const MFA_COOKIE = "__Host-mfa";
const CHALLENGE_SECONDS = 5 * 60;
const CHALLENGE_ATTEMPTS = 5;
const ACCOUNT_FAILURES = 10;
const ACCOUNT_LOCK_SECONDS = 60 * 60;
const RECOVERY_CODES = 10;
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const invalidCode = () =>
  new BadRequestException({
    code: AuthErrorCode.mfaInvalidCode,
    detail: "Código incorreto. Confira o app autenticador e tente de novo.",
  });

const accountLocked = () =>
  new HttpException(
    {
      code: AuthErrorCode.mfaLocked,
      detail: "Muitos códigos errados. Por segurança, tente de novo daqui a uma hora.",
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

const challengeExpired = () =>
  new BadRequestException({
    code: AuthErrorCode.mfaChallengeExpired,
    detail: "A verificação expirou. Entre de novo.",
  });

export interface ChallengeValue {
  userId: string;
  pendingPasswordHash?: string;
}

function parseChallenge(raw: string | null): ChallengeValue | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ChallengeValue>;
    return typeof value.userId === "string" ? (value as ChallengeValue) : null;
  } catch {
    return null;
  }
}

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

  async startChallenge(
    userId: string,
    reply: FastifyReply,
    pendingPasswordHash?: string,
  ): Promise<void> {
    if (await this.isLocked(userId)) throw accountLocked();
    const token = generateToken();
    const value: ChallengeValue = {
      userId,
      ...(pendingPasswordHash ? { pendingPasswordHash } : {}),
    };
    await this.redis.set(this.challengeKey(token), JSON.stringify(value), "EX", CHALLENGE_SECONDS);
    void reply.setCookie(MFA_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: CHALLENGE_SECONDS,
    });
  }

  async completeChallenge(
    request: FastifyRequest,
    reply: FastifyReply,
    code: string,
  ): Promise<ChallengeValue> {
    const token = request.cookies[MFA_COOKIE];
    if (!token || !TOKEN_FORMAT.test(token)) throw challengeExpired();
    const key = this.challengeKey(token);
    const challenge = parseChallenge(await this.redis.get(key));
    if (!challenge) {
      this.clearChallengeCookie(reply);
      throw challengeExpired();
    }
    const { userId } = challenge;
    if (await this.isLocked(userId)) {
      await this.redis.del(key, `${key}:tentativas`);
      this.clearChallengeCookie(reply);
      throw accountLocked();
    }

    const ok = await this.db.asUser(userId, (tx) => this.checkFactor(tx, userId, code));
    if (!ok) {
      const failures = await this.redis.incr(this.failuresKey(userId));
      if (failures === 1) await this.redis.expire(this.failuresKey(userId), ACCOUNT_LOCK_SECONDS);
      if (failures >= ACCOUNT_FAILURES) {
        this.logger.warn(`segundo passo travado por excesso de códigos errados ${userId}`);
        await this.redis.del(key, `${key}:tentativas`);
        this.clearChallengeCookie(reply);
        throw accountLocked();
      }
      const attempts = await this.redis.incr(`${key}:tentativas`);
      if (attempts === 1) await this.redis.expire(`${key}:tentativas`, CHALLENGE_SECONDS);
      if (attempts >= CHALLENGE_ATTEMPTS) {
        await this.redis.del(key, `${key}:tentativas`);
        this.clearChallengeCookie(reply);
        throw challengeExpired();
      }
      throw invalidCode();
    }
    await this.redis.del(key, `${key}:tentativas`, this.failuresKey(userId));
    this.clearChallengeCookie(reply);
    return challenge;
  }

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

  private async isLocked(userId: string): Promise<boolean> {
    return Number(await this.redis.get(this.failuresKey(userId))) >= ACCOUNT_FAILURES;
  }

  private failuresKey(userId: string): string {
    return `mfa:falhas:${userId}`;
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
