import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import {
  type CreateTemplateBody,
  createTemplateBodySchema,
  type ImportTemplateBody,
  importTemplateBodySchema,
  type ImportTemplateResult,
  shareCodeParamsSchema,
  type SharedTemplate,
  templateIdParamsSchema,
  type TemplatePreview,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { type AuthContext, CurrentAuth, Public, RequireVerifiedEmail } from "../auth/decorators";
import { IdempotencyKey } from "../common/idempotency";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { SharingService } from "./sharing.service";

const codePipe = new ZodPipe(shareCodeParamsSchema);

@Controller("v1/templates")
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post()
  @RequireVerifiedEmail()
  @RateLimit({ bucket: "template-create", by: "user", limit: 30, windowSeconds: 3600 })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createTemplateBodySchema)) body: CreateTemplateBody,
  ): Promise<SharedTemplate> {
    return this.sharing.create(auth.userId, body);
  }

  @Get()
  async list(): Promise<{ templates: SharedTemplate[] }> {
    return { templates: await this.sharing.list() };
  }

  @Delete(":id")
  @HttpCode(204)
  async revoke(@Param(new ZodPipe(templateIdParamsSchema)) { id }: { id: string }): Promise<void> {
    await this.sharing.revoke(id);
  }

  @Get(":code")
  @Public()
  @RateLimit({ bucket: "template-preview", by: "ip", limit: 30, windowSeconds: 60 })
  preview(@Param(codePipe) { code }: { code: string }): Promise<TemplatePreview> {
    return this.sharing.preview(code);
  }

  @Post(":code/import")
  @RateLimit({ bucket: "template-import", by: "user", limit: 20, windowSeconds: 3600 })
  async import(
    @CurrentAuth() auth: AuthContext,
    @Param(codePipe) { code }: { code: string },
    @Body(new ZodPipe(importTemplateBodySchema)) body: ImportTemplateBody,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ImportTemplateResult> {
    const result = await this.sharing.import(auth.userId, code, body, key);
    void reply.status(result.status);
    if (result.replayed) void reply.header("idempotent-replayed", "true");
    return result.body;
  }
}
