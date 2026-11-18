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
  UnauthorizedException,
} from "@nestjs/common";
import {
  AuthErrorCode,
  type DeleteMeBody,
  deleteMeBodySchema,
  type MeResponse,
  sessionIdParamsSchema,
  type SessionsResponse,
  type UpdateMeBody,
  updateMeBodySchema,
} from "@presenca/contracts";
import { schema } from "@presenca/db";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { type AuthContext, CurrentAuth } from "../auth/decorators";
import { PasswordService } from "../auth/password.service";
import { SessionService } from "../auth/session.service";
import { toMe } from "../auth/user-mapper";
import { ZodPipe } from "../common/zod.pipe";
import { DbService } from "../database/db.service";
import { RateLimit } from "../rate-limit/rate-limit";

@Controller("v1/me")
export class MeController {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
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

  @Get("export.json")
  @RateLimit({ bucket: "export", by: "user", limit: 10, windowSeconds: 3600 })
  async exportData(@Res({ passthrough: true }) reply: FastifyReply) {
    const data = await this.db.tx(async (tx) => {
      const user = await tx.query.users.findFirst();
      if (!user) throw new NotFoundException();

      const preferences = await tx.query.notificationPreferences.findFirst();
      const semesters = await tx
        .select()
        .from(schema.semesters)
        .orderBy(asc(schema.semesters.startsOn));
      const subjects = await tx.select().from(schema.subjects).orderBy(asc(schema.subjects.name));
      const schedules = await tx
        .select()
        .from(schema.subjectSchedules)
        .orderBy(asc(schema.subjectSchedules.weekday), asc(schema.subjectSchedules.startsAt));
      const calendarExceptions = await tx
        .select()
        .from(schema.calendarExceptions)
        .orderBy(asc(schema.calendarExceptions.startsOn));
      const attendanceLogs = await tx
        .select()
        .from(schema.attendanceLogs)
        .orderBy(asc(schema.attendanceLogs.classDate), asc(schema.attendanceLogs.createdAt));
      const auditEvents = await tx
        .select()
        .from(schema.attendanceLogEvents)
        .orderBy(asc(schema.attendanceLogEvents.id));
      const sharedTemplates = await tx
        .select()
        .from(schema.sharedTemplates)
        .orderBy(asc(schema.sharedTemplates.createdAt));
      const templateImports = await tx
        .select()
        .from(schema.templateImports)
        .orderBy(asc(schema.templateImports.importedAt));
      const notifications = await tx
        .select({
          id: schema.notificationLogs.id,
          kind: schema.notificationLogs.kind,
          subjectId: schema.notificationLogs.subjectId,
          thresholdPct: schema.notificationLogs.thresholdPct,
          payload: schema.notificationLogs.payload,
          readAt: schema.notificationLogs.readAt,
          createdAt: schema.notificationLogs.createdAt,
        })
        .from(schema.notificationLogs)
        .where(eq(schema.notificationLogs.channel, "in_app"))
        .orderBy(asc(schema.notificationLogs.createdAt));

      return {
        exportedAt: new Date().toISOString(),
        user: {
          ...toMe(user),
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        notificationPreferences: preferences ?? null,
        semesters,
        subjects,
        schedules,
        calendarExceptions,
        attendanceLogs,
        auditEvents,
        sharedTemplates,
        templateImports,
        notifications,
      };
    });

    void reply.header("content-type", "application/json; charset=utf-8");
    void reply.header("content-disposition", 'attachment; filename="meus-dados-presenca.json"');
    return data;
  }

  @Delete()
  @HttpCode(204)
  @RateLimit({ bucket: "account-delete", by: "user", limit: 5, windowSeconds: 900 })
  async deleteAccount(
    @Body(new ZodPipe(deleteMeBodySchema)) body: DeleteMeBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      const user = await tx.query.users.findFirst();
      if (!user) throw new NotFoundException();

      if (user.passwordHash !== null) {
        const ok =
          typeof body.password === "string" &&
          (await this.passwords.verify(user.passwordHash, body.password));
        if (!ok) {
          throw new UnauthorizedException({
            code: AuthErrorCode.invalidCredentials,
            detail: "Senha incorreta.",
          });
        }
      } else {
        const ok = typeof body.email === "string" && body.email === user.email;
        if (!ok) {
          throw new UnauthorizedException({
            code: AuthErrorCode.invalidCredentials,
            detail: "O e-mail informado não confere com o da conta.",
          });
        }
      }

      await tx.execute(sql`select app.delete_current_user()`);
    });

    this.sessions.clearCookie(reply);
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
