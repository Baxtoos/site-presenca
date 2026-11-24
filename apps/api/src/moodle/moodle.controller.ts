import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import {
  type MoodleConnectBody,
  moodleConnectBodySchema,
  type MoodleCourse,
  type MoodleCourseBody,
  moodleCourseBodySchema,
  moodleCourseParamsSchema,
  moodleDisconnectQuerySchema,
  type MoodleStatus,
  type MoodleSyncResult,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { IdempotencyKey } from "../common/idempotency";
import { IfMatchVersion, setEtag } from "../common/versioning";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { MoodleService } from "./moodle.service";

/** Conector do Moodle do aluno logado. Cada conectar/sincronizar faz buscas externas: com limite. */
@Controller("v1/moodle")
export class MoodleController {
  constructor(private readonly moodle: MoodleService) {}

  @Get()
  async status(@Res({ passthrough: true }) reply: FastifyReply): Promise<MoodleStatus> {
    const status = await this.moodle.status();
    if (status.connection) setEtag(reply, status.connection.version);
    return status;
  }

  @Put()
  @RateLimit({ bucket: "moodle-connect", by: "user", limit: 10, windowSeconds: 3600 })
  async connect(
    @Body(new ZodPipe(moodleConnectBodySchema)) body: MoodleConnectBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MoodleSyncResult> {
    const result = await this.moodle.connect(body);
    if (result.status.connection) setEtag(reply, result.status.connection.version);
    return result;
  }

  @Post("sync")
  @HttpCode(200)
  @RateLimit({ bucket: "moodle-sync", by: "user", limit: 6, windowSeconds: 3600 })
  async sync(
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MoodleSyncResult> {
    const result = await this.moodle.sync(key);
    if (result.replayed) void reply.header("idempotent-replayed", "true");
    if (result.body.status.connection) setEtag(reply, result.body.status.connection.version);
    return result.body;
  }

  @Patch("courses/:id")
  async updateCourse(
    @Param(new ZodPipe(moodleCourseParamsSchema)) { id }: { id: string },
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(moodleCourseBodySchema)) body: MoodleCourseBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MoodleCourse> {
    const course = await this.moodle.updateCourse(id, version, body);
    setEtag(reply, course.version);
    return course;
  }

  @Delete()
  @HttpCode(204)
  async disconnect(
    @IfMatchVersion() version: number,
    @Query(new ZodPipe(moodleDisconnectQuerySchema)) query: { keepTasks: "true" | "false" },
  ): Promise<void> {
    await this.moodle.disconnect(version, query.keepTasks === "true");
  }
}
