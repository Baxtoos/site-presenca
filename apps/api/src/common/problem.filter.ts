import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { Problem } from "@presenca/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { buildProblem, PROBLEM_CONTENT_TYPE } from "./problem";

interface FastifyLikeError {
  statusCode?: number;
  code?: string;
  message?: string;
}

/**
 * Converte qualquer erro em application/problem+json (RFC 9457).
 * Erros 5xx nunca expõem mensagem interna nem stack: só o requestId, para suporte.
 */
export function toProblem(error: unknown, requestId: string): Problem {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    const body =
      typeof response === "object" && response !== null
        ? (response as Record<string, unknown>)
        : {};
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    return buildProblem(status, {
      requestId,
      code: typeof body.code === "string" ? body.code : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      detail: status < 500 ? detail : undefined,
      errors: Array.isArray(body.errors) ? (body.errors as Problem["errors"]) : undefined,
    });
  }

  // Erros do próprio Fastify (JSON inválido, corpo grande demais, content-type não suportado).
  const fastifyError = error as FastifyLikeError;
  if (
    typeof fastifyError?.statusCode === "number" &&
    fastifyError.statusCode >= 400 &&
    fastifyError.statusCode < 500
  ) {
    return buildProblem(fastifyError.statusCode, { requestId });
  }

  return buildProblem(500, { requestId });
}

export function sendProblem(reply: FastifyReply, problem: Problem): void {
  void reply.status(problem.status).header("content-type", PROBLEM_CONTENT_TYPE).send(problem);
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const problem = toProblem(error, request.id);

    if (problem.status >= 500) {
      this.logger.error({ err: error, requestId: request.id }, "erro não tratado");
    }
    sendProblem(reply, problem);
  }
}
