import { createHash } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { ENV, type Env } from "../config/env";
import { REDIS } from "../redis/redis.module";

/** Por onde contar: IP, e-mail do corpo, IP + e-mail, ou o usuário logado. */
export type RateLimitKey = "ip" | "email" | "ip+email" | "user";

export interface RateLimitRule {
  /** Nome do contador (ex.: "login"). Regras com o mesmo nome compartilham o contador. */
  bucket: string;
  by: RateLimitKey;
  limit: number;
  windowSeconds: number;
}

const RATE_LIMIT_RULES = "rate-limit:rules";

/** Aplica um ou mais limites à rota. Todos precisam passar. */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_RULES, rules);

export interface HitResult {
  allowed: boolean;
  /** Segundos até o contador zerar. */
  retryAfter: number;
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Janela fixa: INCR + EXPIRE NX numa transação. A chave guarda só o hash do identificador
   * (e-mails não ficam em texto no Redis).
   */
  async hit(rule: RateLimitRule, identifier: string): Promise<HitResult> {
    const digest = createHash("sha256").update(identifier).digest("base64url").slice(0, 22);
    const key = `rl:${rule.bucket}:${rule.by}:${digest}`;
    const results = await this.redis
      .multi()
      .incr(key)
      .expire(key, rule.windowSeconds, "NX")
      .ttl(key)
      .exec();
    if (!results || results.some(([error]) => error)) {
      throw new Error("falha ao atualizar contador de rate limit");
    }
    const count = Number(results[0]![1]);
    const ttl = Number(results[2]![1]);
    return { allowed: count <= rule.limit, retryAfter: ttl > 0 ? ttl : rule.windowSeconds };
  }
}

function identifierFor(by: RateLimitKey, request: FastifyRequest): string | undefined {
  const body = request.body as { email?: unknown } | undefined;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : undefined;
  switch (by) {
    case "ip":
      return request.ip;
    case "email":
      return email;
    case "ip+email":
      return email === undefined ? undefined : `${request.ip}|${email}`;
    case "user":
      return request.auth?.userId;
  }
}

/**
 * Guard que aplica os limites declarados com @RateLimit. Se o Redis estiver fora, recusa (503):
 * sem contador não há proteção contra força bruta, e rotas de login não devem ficar abertas.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    @Inject(ENV) private readonly env: Pick<Env, "RATE_LIMIT_FACTOR">,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_RULES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    for (const rule of rules) {
      const identifier = identifierFor(rule.by, request);
      // Sem e-mail no corpo, a validação do corpo responde 422; a regra por IP continua valendo.
      if (identifier === undefined) continue;

      let result: HitResult;
      try {
        result = await this.limiter.hit(
          { ...rule, limit: rule.limit * this.env.RATE_LIMIT_FACTOR },
          identifier,
        );
      } catch (error) {
        this.logger.error(error instanceof Error ? error : String(error));
        throw new ServiceUnavailableException({
          code: "RATE_LIMIT_UNAVAILABLE",
          detail: "Serviço temporariamente indisponível. Tente de novo em instantes.",
        });
      }

      if (!result.allowed) {
        void reply.header("retry-after", String(result.retryAfter));
        throw new HttpException(
          {
            code: "RATE_LIMITED",
            detail: `Muitas tentativas. Tente de novo em ${result.retryAfter} segundos.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
