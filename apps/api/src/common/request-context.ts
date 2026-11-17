import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface RequestContext {
  requestId: string;
  /** Preenchido pelo guard de sessão (Fase 2). */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Contexto da requisição atual, disponível em qualquer ponto da cadeia assíncrona. */
export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Aproveita o X-Request-Id recebido (ex.: do proxy) se tiver formato seguro; senão gera um UUID.
 * Valores fora do padrão são descartados para não poluir logs nem permitir injeção.
 */
export function genRequestId(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];
  return typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
}
