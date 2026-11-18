import { z } from "zod";
import { problemSchema } from "./problem";
import type { RouteDef } from "./route-types";

type JsonSchema = Record<string, unknown>;

const toSchema = (schema: z.ZodType, io: "input" | "output"): JsonSchema => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" });
  return rest;
};

/** `/v1/semesters/:id` → `/v1/semesters/{id}` */
const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

/** Erros que qualquer rota pode devolver, todos no formato problem+json. */
const COMMON_ERRORS: Record<number, string> = {
  400: "Requisição malformada",
  413: "Corpo da requisição grande demais",
  422: "Dados inválidos",
  429: "Muitas requisições",
  500: "Erro interno",
};

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

/** Gera um documento OpenAPI 3.1 a partir do registro de rotas. */
export function buildOpenApiDocument(routes: Record<string, RouteDef>, info: OpenApiInfo) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [operationId, route] of Object.entries(routes)) {
    const responses: Record<string, unknown> = {};
    for (const [status, res] of Object.entries(route.responses)) {
      responses[status] = res.schema
        ? {
            description: res.description,
            content: { "application/json": { schema: toSchema(res.schema, "output") } },
          }
        : { description: res.description };
    }
    for (const [status, description] of Object.entries(COMMON_ERRORS)) {
      responses[status] ??= {
        description,
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      };
    }
    if (route.auth) {
      responses["401"] ??= {
        description: "Sessão ausente ou expirada",
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      };
    }

    const parameters: unknown[] = [];
    for (const [location, schema] of [
      ["path", route.request?.params],
      ["query", route.request?.query],
    ] as const) {
      if (!schema) continue;
      const json = toSchema(schema, "input") as {
        properties?: Record<string, JsonSchema>;
        required?: string[];
      };
      for (const [name, propSchema] of Object.entries(json.properties ?? {})) {
        parameters.push({
          name,
          in: location,
          required: location === "path" || (json.required ?? []).includes(name),
          schema: propSchema,
        });
      }
    }

    const operation: Record<string, unknown> = {
      operationId,
      summary: route.summary,
      tags: [route.tag],
      responses,
    };
    if (parameters.length > 0) operation.parameters = parameters;
    if (route.request?.body) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: toSchema(route.request.body, "input") } },
      };
    }
    if (route.auth) operation.security = [{ session: [] }];
    if (route.idempotent) {
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        description:
          "Identificador único desta ação (de 8 a 128 caracteres). Repetir com o mesmo corpo devolve a resposta original; com corpo diferente, 422.",
        schema: { type: "string", minLength: 8, maxLength: 128 },
      });
      operation.parameters = parameters;
      responses["428"] ??= {
        description: "Faltou o cabeçalho Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED)",
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      };
    }
    if (route.ifMatch) {
      parameters.push({
        name: "If-Match",
        in: "header",
        required: true,
        description: 'Versão atual do recurso, como veio no ETag (ex.: "3").',
        schema: { type: "string" },
      });
      operation.parameters = parameters;
      responses["412"] ??= {
        description: "Versão desatualizada: outro dispositivo alterou antes (VERSION_MISMATCH)",
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      };
      responses["428"] ??= {
        description: "Faltou o cabeçalho If-Match (VERSION_REQUIRED)",
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
        },
      };
    }

    const path = toOpenApiPath(route.path);
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info,
    paths,
    components: {
      schemas: { Problem: toSchema(problemSchema, "output") },
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "__Host-sid" },
      },
    },
  };
}
