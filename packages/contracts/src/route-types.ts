import type { z } from "zod";

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
  /** Exige o cabeçalho If-Match com a versão atual (controle de concorrência). */
  ifMatch?: boolean;
  request?: {
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
  };
  responses: Record<number, RouteResponse>;
}
