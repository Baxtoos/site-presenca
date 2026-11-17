import type { z } from "zod";
import { healthResponseSchema, readinessResponseSchema } from "./health";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
}

/**
 * Definição de uma rota da API. A API valida a entrada com estes schemas, o OpenAPI é gerado
 * a partir deles e um teste garante que toda rota registrada na API está aqui (e vice-versa).
 */
export interface RouteDef {
  method: HttpMethod;
  /** Caminho no formato Fastify/Nest (`/v1/semesters/:id`). */
  path: string;
  summary: string;
  tag: string;
  /** Exige sessão (Fase 2). */
  auth: boolean;
  request?: {
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
  };
  responses: Record<number, RouteResponse>;
}

export const routes = {
  health: {
    method: "GET",
    path: "/healthz",
    summary: "Processo vivo (não toca em dependências externas)",
    tag: "Saúde",
    auth: false,
    responses: { 200: { description: "Processo no ar", schema: healthResponseSchema } },
  },
  readiness: {
    method: "GET",
    path: "/readyz",
    summary: "Pronto para receber tráfego (banco acessível)",
    tag: "Saúde",
    auth: false,
    responses: {
      200: { description: "Pronto", schema: readinessResponseSchema },
      503: { description: "Alguma dependência fora do ar", schema: readinessResponseSchema },
    },
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
