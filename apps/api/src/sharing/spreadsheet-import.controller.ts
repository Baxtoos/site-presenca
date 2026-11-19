import { Body, Controller, Post, Res } from "@nestjs/common";
import {
  type SemesterImportBody,
  semesterImportBodySchema,
  type SemesterImportResult,
} from "@presenca/contracts";
import type { FastifyReply } from "fastify";
import { type AuthContext, CurrentAuth } from "../auth/decorators";
import { IdempotencyKey } from "../common/idempotency";
import { ZodPipe } from "../common/zod.pipe";
import { RateLimit } from "../rate-limit/rate-limit";
import { SpreadsheetImportService } from "./spreadsheet-import.service";

/** Caminho com limite de corpo maior (uma planilha de semestre inteiro): ver common/http.ts. */
export const SPREADSHEET_IMPORT_PATH = "/v1/imports/semester";

/**
 * Importação da planilha exportada pelo app. O site lê o arquivo no navegador e manda os dados já
 * estruturados; a API valida tudo e cria o semestre numa transação só.
 */
@Controller("v1/imports")
export class SpreadsheetImportController {
  constructor(private readonly imports: SpreadsheetImportService) {}

  @Post("semester")
  @RateLimit({ bucket: "spreadsheet-import", by: "user", limit: 10, windowSeconds: 3600 })
  async importSemester(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(semesterImportBodySchema)) body: SemesterImportBody,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SemesterImportResult> {
    const result = await this.imports.import(auth.userId, body, key);
    void reply.status(result.status);
    if (result.replayed) void reply.header("idempotent-replayed", "true");
    return result.body;
  }
}
