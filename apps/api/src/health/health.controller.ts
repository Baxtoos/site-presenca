import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@presenca/contracts";
import type { DbHandle } from "@presenca/db";
import type { FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import { Public } from "../auth/decorators";
import { ENV, type Env } from "../config/env";
import { DB } from "../database/tokens";
import { REDIS } from "../redis/redis.module";

type Check = ReadinessResponse["checks"][string];

async function measure(probe: () => Promise<unknown>): Promise<Check> {
  const started = performance.now();
  try {
    await probe();
    return { status: "up", latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: "down" };
  }
}

@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Pick<DbHandle, "ping">,
    @Inject(REDIS) private readonly redis: Pick<Redis, "ping">,
    @Inject(ENV) private readonly env: Pick<Env, "APP_VERSION">,
  ) {}

  /** Processo vivo. Não toca em dependências externas. */
  @Get("healthz")
  health(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      version: this.env.APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /**
   * Pronto para receber tráfego: banco e Redis acessíveis (sem Redis o login fica bloqueado
   * pelo rate limit). O deploy só troca de versão quando isto responde 200.
   */
  @Get("readyz")
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      measure(() => this.db.ping()),
      measure(() => this.redis.ping()),
    ]);
    const ok = database.status === "up" && redis.status === "up";
    void reply.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? "ready" : "not_ready", checks: { database, redis } };
  }
}
