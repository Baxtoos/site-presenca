import helmet from "@fastify/helmet";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Logger } from "pino";
import type { Env } from "../config/env";
import { buildProblem } from "./problem";
import { ProblemFilter, sendProblem } from "./problem.filter";
import { genRequestId, requestContext } from "./request-context";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** O tipo do adaptador do Nest não aceita número; "confiar em N saltos" vira a função equivalente. */
function toFastifyTrustProxy(
  value: Env["TRUST_PROXY"],
): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof value === "number" ? (_address, hop) => hop < value : value;
}

/** Adaptador Fastify com logs, request id, limite de corpo e proxies confiáveis. */
export function createFastifyAdapter(env: Env, logger: Logger): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    genReqId: genRequestId,
    requestIdLogLabel: "requestId",
    bodyLimit: 64 * 1024,
    trustProxy: toFastifyTrustProxy(env.TRUST_PROXY),
    return503OnClosing: true,
  });
}

/**
 * Configuração HTTP comum à aplicação real e aos testes.
 * Precisa rodar antes de `app.init()`.
 */
export async function configureApp(
  app: NestFastifyApplication,
  env: Env,
  logger: Logger,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  // Cabeçalhos de segurança. A API só responde JSON; nenhuma página é servida.
  await app.register(helmet as never, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });

  fastify.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);

    // Escritas só vindas do próprio app web. O navegador sempre envia Origin em POST/PUT/PATCH/DELETE;
    // uma origem diferente é outro site tentando agir em nome do usuário (CSRF).
    const origin = request.headers.origin;
    if (UNSAFE_METHODS.has(request.method) && origin !== undefined && origin !== env.WEB_ORIGIN) {
      request.log.warn({ origin }, "escrita recusada: origem não permitida");
      sendProblem(
        reply,
        buildProblem(403, {
          code: "ORIGIN_NOT_ALLOWED",
          detail: "Requisições de escrita só são aceitas a partir do app.",
          requestId: request.id,
        }),
      );
      return;
    }

    requestContext.run({ requestId: request.id }, done);
  });

  // O Nest registra o errorHandler e o notFoundHandler do Fastify e encaminha tudo (JSON inválido,
  // corpo grande, content-type, rota inexistente) para os filtros globais: o ProblemFilter cobre.
  app.useGlobalFilters(new ProblemFilter(logger));
  app.enableShutdownHooks();
}
