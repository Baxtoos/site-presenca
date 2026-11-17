import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@presenca/contracts";
import type { DbHandle } from "@presenca/db";
import type { FastifyReply } from "fastify";
import { DB } from "../database/database.module";

const VERSION = process.env.APP_VERSION ?? "dev";

@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Pick<DbHandle, "ping">) {}

  /** Processo vivo. Não toca em dependências externas. */
  @Get("healthz")
  health(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      version: VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /** Pronto para receber tráfego: banco acessível. O deploy só troca de versão quando isto responde 200. */
  @Get("readyz")
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    let database: ReadinessResponse["checks"][string];
    try {
      database = { status: "up", latencyMs: await this.db.ping() };
    } catch {
      database = { status: "down" };
    }
    const ok = database.status === "up";
    reply.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? "ready" : "not_ready", checks: { database } };
  }
}
