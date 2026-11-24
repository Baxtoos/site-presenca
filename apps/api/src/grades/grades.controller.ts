import { Body, Controller, Get, Headers, Param, Patch, Put, Res } from "@nestjs/common";
import {
  evaluationItemParamsSchema,
  idParamsSchema,
  type SaveGradingBody,
  saveGradingBodySchema,
  scoreBodySchema,
  type SubjectGrading,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { IfMatchVersion, setEtag } from "../common/versioning";
import { ZodPipe } from "../common/zod.pipe";
import { GradesService } from "./grades.service";

/** Notas das matérias do aluno logado (o RLS só deixa ver e mexer nas próprias). */
@Controller("v1")
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  @Get("subjects/:id/grading")
  async get(
    @Param(new ZodPipe(idParamsSchema)) { id }: { id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SubjectGrading> {
    const result = await this.grades.get(id);
    if (result.scheme) setEtag(reply, result.scheme.version);
    return result;
  }

  /** If-Match só é exigido quando a regra já existe (a primeira vez cria). */
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
    @Body(new ZodPipe(scoreBodySchema)) body: { score: number | null },
  ): Promise<SubjectGrading> {
    return this.grades.setScore(id, version, body.score);
  }
}
