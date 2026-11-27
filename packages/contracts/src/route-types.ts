import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
}

export interface RouteDef {
  method: HttpMethod;
  path: string;
  summary: string;
  tag: string;
  auth: boolean;
  ifMatch?: boolean;
  idempotent?: boolean;
  request?: {
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
  };
  responses: Record<number, RouteResponse>;
}
