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
  Res,
} from "@nestjs/common";
import {
  type CalendarExceptionDto,
  type CreateSemesterBody,
  createSemesterBodySchema,
  type CreateSubjectBody,
  createSubjectBodySchema,
  type ExceptionBody,
  exceptionBodySchema,
  exceptionParamsSchema,
  type ExceptionsResponse,
  idParamsSchema,
  type Schedule,
  type ScheduleBody,
  scheduleBodySchema,
  scheduleParamsSchema,
  type Semester,
  type SemestersResponse,
  type Subject,
  type SubjectBody,
  subjectBodySchema,
  type SubjectsResponse,
  type UpdateSemesterBody,
  updateSemesterBodySchema,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { IfMatchVersion, setEtag } from "../common/versioning";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { ExcelExportService } from "./excel-export.service";
import { ExceptionsService } from "./exceptions.service";
import { SemestersService } from "./semesters.service";
import { SubjectsService } from "./subjects.service";

type IdParams = { id: string };
const idPipe = new ZodPipe(idParamsSchema);

@Controller("v1/semesters")
export class SemestersController {
  constructor(
    private readonly semesters: SemestersService,
    private readonly subjects: SubjectsService,
    private readonly exceptions: ExceptionsService,
    private readonly excel: ExcelExportService,
  ) {}

  @Get()
  async list(): Promise<SemestersResponse> {
    return { semesters: await this.semesters.list() };
  }

  @Post()
  async create(
    @Body(new ZodPipe(createSemesterBodySchema)) body: CreateSemesterBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Semester> {
    const semester = await this.semesters.create(body);
    setEtag(reply, semester.version);
    return semester;
  }

  @Get(":id")
  async get(
    @Param(idPipe) { id }: IdParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Semester> {
    const semester = await this.semesters.get(id);
    setEtag(reply, semester.version);
    return semester;
  }

  @Patch(":id")
  async update(
    @Param(idPipe) { id }: IdParams,
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(updateSemesterBodySchema)) body: UpdateSemesterBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Semester> {
    const semester = await this.semesters.update(id, version, body);
    setEtag(reply, semester.version);
    return semester;
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param(idPipe) { id }: IdParams, @IfMatchVersion() version: number): Promise<void> {
    await this.semesters.remove(id, version);
  }

  @Get(":id/subjects")
  async listSubjects(@Param(idPipe) { id }: IdParams): Promise<SubjectsResponse> {
    return { subjects: await this.subjects.list(id) };
  }

  @Post(":id/subjects")
  async createSubject(
    @Param(idPipe) { id }: IdParams,
    @Body(new ZodPipe(createSubjectBodySchema)) body: CreateSubjectBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Subject> {
    const subject = await this.subjects.create(id, body);
    setEtag(reply, subject.version);
    return subject;
  }

  @Get(":id/exceptions")
  async listExceptions(@Param(idPipe) { id }: IdParams): Promise<ExceptionsResponse> {
    return { exceptions: await this.exceptions.list(id) };
  }

  @Post(":id/exceptions")
  createException(
    @Param(idPipe) { id }: IdParams,
    @Body(new ZodPipe(exceptionBodySchema)) body: ExceptionBody,
  ): Promise<CalendarExceptionDto> {
    return this.exceptions.create(id, body);
  }

  @Delete(":id/exceptions/:exceptionId")
  @HttpCode(204)
  async removeException(
    @Param(new ZodPipe(exceptionParamsSchema)) params: { id: string; exceptionId: string },
  ): Promise<void> {
    await this.exceptions.remove(params.id, params.exceptionId);
  }

  @Get(":id/export.xlsx")
  @RateLimit({ bucket: "export", by: "user", limit: 10, windowSeconds: 3600 })
  async exportXlsx(
    @Param(idPipe) { id }: IdParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { buffer, filename } = await this.excel.exportSemester(id);
    void reply.header(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    void reply.header("content-disposition", `attachment; filename="${filename}"`);
    return buffer;
  }
}

@Controller("v1/subjects")
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get(":id")
  async get(
    @Param(idPipe) { id }: IdParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Subject> {
    const subject = await this.subjects.get(id);
    setEtag(reply, subject.version);
    return subject;
  }

  @Put(":id")
  async replace(
    @Param(idPipe) { id }: IdParams,
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(subjectBodySchema)) body: SubjectBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Subject> {
    const subject = await this.subjects.replace(id, version, body);
    setEtag(reply, subject.version);
    return subject;
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param(idPipe) { id }: IdParams, @IfMatchVersion() version: number): Promise<void> {
    await this.subjects.remove(id, version);
  }

  @Post(":id/schedules")
  addSchedule(
    @Param(idPipe) { id }: IdParams,
    @Body(new ZodPipe(scheduleBodySchema)) body: ScheduleBody,
  ): Promise<Schedule> {
    return this.subjects.addSchedule(id, body);
  }

  @Put(":id/schedules/:scheduleId")
  async replaceSchedule(
    @Param(new ZodPipe(scheduleParamsSchema)) params: { id: string; scheduleId: string },
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(scheduleBodySchema)) body: ScheduleBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schedule> {
    const schedule = await this.subjects.replaceSchedule(
      params.id,
      params.scheduleId,
      version,
      body,
    );
    setEtag(reply, schedule.version);
    return schedule;
  }

  @Delete(":id/schedules/:scheduleId")
  @HttpCode(204)
  async removeSchedule(
    @Param(new ZodPipe(scheduleParamsSchema)) params: { id: string; scheduleId: string },
  ): Promise<void> {
    await this.subjects.removeSchedule(params.id, params.scheduleId);
  }
}
