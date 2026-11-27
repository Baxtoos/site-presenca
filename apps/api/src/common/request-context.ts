import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface RequestContext {
  requestId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function genRequestId(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];
  return typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
}
