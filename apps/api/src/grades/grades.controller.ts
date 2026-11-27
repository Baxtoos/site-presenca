import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import {
  evaluationItemParamsSchema,
  type GradingAssistantRequest,
  gradingAssistantRequestSchema,
  type GradingAssistantResponse,
  idParamsSchema,
  type SaveGradingBody,
  saveGradingBodySchema,
  scoreBodySchema,
  type SubjectGrading,
  type GradesOverview,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { IfMatchVersion, setEtag } from "../common/versioning";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { GradingAssistantService } from "./assistant.service";
import { GradesService } from "./grades.service";

@Controller("v1")
export class GradesController {
  constructor(
    private readonly grades: GradesService,
    private readonly assistant: GradingAssistantService,
  ) {}

  @Post("subjects/:id/grading/assistant")
  @HttpCode(200)
  @RateLimit({ bucket: "grading-ai", by: "user", limit: 30, windowSeconds: 86_400 })
  assist(
    @Param(new ZodPipe(idParamsSchema)) { id }: { id: string },
    @Body(new ZodPipe(gradingAssistantRequestSchema)) body: GradingAssistantRequest,
  ): Promise<GradingAssistantResponse> {
    return this.assistant.turn(id, body);
  }

  @Get("grades")
  overview(): Promise<GradesOverview> {
    return this.grades.overview();
  }

  @Get("subjects/:id/grading")
  async get(
    @Param(new ZodPipe(idParamsSchema)) { id }: { id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SubjectGrading> {
    const result = await this.grades.get(id);
    if (result.scheme) setEtag(reply, result.scheme.version);
    return result;
  }

  @Put("subjects/:id/grading")
  async save(
    @Param(new ZodPipe(idParamsSchema)) { id }: { id: string },
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodPipe(saveGradingBodySchema)) body: SaveGradingBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SubjectGrading> {
    const result = await this.grades.save(id, ifMatch, body);
    if (result.scheme) setEtag(reply, result.scheme.version);
    return result;
  }

  @Patch("evaluation-items/:id")
  async setScore(
    @Param(new ZodPipe(evaluationItemParamsSchema)) { id }: { id: string },
    @IfMatchVersion() version: number,
    @Body(new ZodPipe(scoreBodySchema)) body: { score: number | null; completeTask?: boolean },
  ): Promise<SubjectGrading> {
    return this.grades.setScore(id, version, body.score, body.completeTask);
  }
}
