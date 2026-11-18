import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  type AttendanceDeleted,
  type AttendanceList,
  type AttendanceListQuery,
  attendanceListQuerySchema,
  attendanceParamsSchema,
  type AttendanceResult,
  type CreateAttendanceBody,
  createAttendanceBodySchema,
  idParamsSchema,
  type SimulateResponse,
  todayQuerySchema,
  type TodayResponse,
  type UpdateAttendanceBody,
  updateAttendanceBodySchema,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { IdempotencyKey } from "../common/idempotency";
import { IfMatchVersion, setEtag } from "../common/versioning";
import { ZodPipe } from "../common/zod.pipe";
import { AttendanceService } from "./attendance.service";
import { SimulateService } from "./simulate.service";
import { TodayService } from "./today.service";

const idPipe = new ZodPipe(idParamsSchema);

@Controller("v1")
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly today: TodayService,
    private readonly simulate: SimulateService,
  ) {}

  @Get("today")
  getToday(@Query(new ZodPipe(todayQuerySchema)) query: { date?: string }): Promise<TodayResponse> {
    return this.today.get(query.date);
  }

  /**
   * Registra uma aula. Exige Idempotency-Key: repetir a chamada (clique duplo, reenvio da fila
   * offline) devolve a resposta original, com `Idempotent-Replayed: true`, sem gravar de novo.
   */
  @Post("attendance")
  async create(
    @Body(new ZodPipe(createAttendanceBodySchema)) body: CreateAttendanceBody,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AttendanceResult> {
    const result = await this.attendance.create(body, key);
    void reply.status(result.status);
    if (result.replayed) void reply.header("idempotent-replayed", "true");
    setEtag(reply, result.body.record.version);
    return result.body;
  }

  @Patch("attendance/:id")
  async update(
    @Param(new ZodPipe(attendanceParamsSchema)) { id }: { id: string },
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(updateAttendanceBodySchema)) body: UpdateAttendanceBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AttendanceResult> {
    const result = await this.attendance.update(id, version, body);
    setEtag(reply, result.record.version);
    return result;
  }

  @Delete("attendance/:id")
  @HttpCode(200)
  remove(
    @Param(new ZodPipe(attendanceParamsSchema)) { id }: { id: string },
    @IfMatchVersion() version: number,
  ): Promise<AttendanceDeleted> {
    return this.attendance.remove(id, version);
  }

  @Get("subjects/:id/attendance")
  list(
    @Param(idPipe) { id }: { id: string },
    @Query(new ZodPipe(attendanceListQuerySchema)) query: AttendanceListQuery,
  ): Promise<AttendanceList> {
    return this.attendance.list(id, query);
  }

  @Get("subjects/:id/simulate")
  getSimulation(@Param(idPipe) { id }: { id: string }): Promise<SimulateResponse> {
    return this.simulate.get(id);
  }
}
