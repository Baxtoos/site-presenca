import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { LogController } from "fastify";
import type { Logger } from "pino";
import type { Env } from "../config/env";
import { resolveClientIp } from "./client-ip";
import { buildProblem } from "./problem";
import { ProblemFilter, sendProblem } from "./problem.filter";
import { genRequestId, requestContext } from "./request-context";
import { SESSION_COOKIE } from "../auth/session.service";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function toFastifyTrustProxy(
  value: Env["TRUST_PROXY"],
): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof value === "number" ? (_address, hop) => hop < value : value;
}

export function createFastifyAdapter(env: Env, logger: Logger): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    genReqId: genRequestId,
    logController: new LogController({ requestIdLogLabel: "requestId" }),
    bodyLimit: 64 * 1024,
    trustProxy: toFastifyTrustProxy(env.TRUST_PROXY),
    return503OnClosing: true,
  });
}

const LARGE_BODY_LIMITS: Record<string, number> = {
  "/v1/imports/semester": 2 * 1024 * 1024,
  "/v1/imports/suap": 1024 * 1024,
};

export async function configureApp(
  app: NestFastifyApplication,
  env: Env,
  logger: Logger,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook("onRoute", (route) => {
    const limit = LARGE_BODY_LIMITS[route.url];
    if (limit) route.bodyLimit = limit;
  });

  await app.register(helmet as never, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  await app.register(cookie as never);

  fastify.addHook("onSend", (_request, reply, payload, done) => {
    if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "no-store");
    done(null, payload);
  });

  fastify.decorateRequest("clientIp", "");
  fastify.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    request.clientIp = resolveClientIp(request, env.API_PROXY_SECRET);

    // Escritas só vindas do próprio app web (CSRF). O navegador sempre envia Origin em
    // POST/PUT/PATCH/DELETE. Origem diferente é outro site agindo em nome do usuário; e uma
    // escrita com cookie de sessão mas sem Origin não veio de um navegador moderno: recusada.
    const origin = request.headers.origin;
    const carriesSession = request.headers.cookie?.includes(`${SESSION_COOKIE}=`) ?? false;
    const crossSite = origin !== undefined && origin !== env.WEB_ORIGIN;
    if (
      UNSAFE_METHODS.has(request.method) &&
      (crossSite || (carriesSession && origin === undefined))
    ) {
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

  app.useGlobalFilters(new ProblemFilter(logger));
  app.enableShutdownHooks();
}
