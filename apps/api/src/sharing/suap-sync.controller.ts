import { Body, Controller, Post, Res } from "@nestjs/common";
import { type SuapSyncBody, suapSyncBodySchema, type SuapSyncResult } from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { type AuthContext, CurrentAuth } from "../auth/decorators";
import { IdempotencyKey } from "../common/idempotency";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { SuapSyncService } from "./suap-sync.service";

export const SUAP_SYNC_PATH = "/v1/imports/suap";

@Controller("v1/imports")
export class SuapSyncController {
  constructor(private readonly suap: SuapSyncService) {}

  @Post("suap")
  @RateLimit({ bucket: "suap-sync", by: "user", limit: 30, windowSeconds: 3600 })
  async sync(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(suapSyncBodySchema)) body: SuapSyncBody,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SuapSyncResult> {
    const result = await this.suap.sync(auth.userId, body, key);
    void reply.status(result.status);
    if (result.replayed) void reply.header("idempotent-replayed", "true");
    return result.body;
  }
}
