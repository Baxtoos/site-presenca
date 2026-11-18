import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Res,
} from "@nestjs/common";
import {
  type MeResponse,
  sessionIdParamsSchema,
  type SessionsResponse,
  type UpdateMeBody,
  updateMeBodySchema,
} from "@presenca/contracts";
import { schema } from "@presenca/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { type AuthContext, CurrentAuth } from "../auth/decorators";
import { SessionService } from "../auth/session.service";
import { toMe } from "../auth/user-mapper";
import { ZodPipe } from "../common/zod.pipe";
import { DbService } from "../database/db.service";

@Controller("v1/me")
export class MeController {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async me(): Promise<MeResponse> {
    const user = await this.db.tx((tx) => tx.query.users.findFirst());
    if (!user) throw new NotFoundException();
    return toMe(user);
  }

  @Patch()
  async update(@Body(new ZodPipe(updateMeBodySchema)) body: UpdateMeBody): Promise<MeResponse> {
    const user = await this.db.tx(async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({
          ...body,
          // Preencher o perfil conclui o onboarding.
          onboardedAt: sql`coalesce(${schema.users.onboardedAt}, now())`,
        })
        .where(eq(schema.users.id, sql`app.current_user_id()`))
        .returning();
      return row;
    });
    if (!user) throw new NotFoundException();
    return toMe(user);
  }

  @Get("sessions")
  async list(@CurrentAuth() auth: AuthContext): Promise<SessionsResponse> {
    const rows = await this.db.tx((tx) =>
      tx
        .select({
          id: schema.sessions.id,
          createdAt: schema.sessions.createdAt,
          lastSeenAt: schema.sessions.lastSeenAt,
          expiresAt: schema.sessions.expiresAt,
          userAgent: schema.sessions.userAgent,
          ip: schema.sessions.ip,
        })
        .from(schema.sessions)
        .where(and(isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, sql`now()`)))
        .orderBy(desc(schema.sessions.lastSeenAt)),
    );
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        userAgent: s.userAgent,
        ip: s.ip,
        current: s.id === auth.sessionId,
      })),
    };
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revoke(
    @Param(new ZodPipe(sessionIdParamsSchema)) params: { id: string },
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    // O RLS garante que só sessões do próprio usuário podem ser encerradas; de outro, vira 404.
    const revoked = await this.sessions.revoke(auth.userId, params.id);
    if (!revoked) throw new NotFoundException({ detail: "Sessão não encontrada ou já encerrada." });
    if (params.id === auth.sessionId) this.sessions.clearCookie(reply);
  }
}
