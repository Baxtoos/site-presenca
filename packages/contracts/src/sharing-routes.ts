import { semesterImportBodySchema, semesterImportResultSchema } from "./imports";
import type { RouteDef } from "./route-types";
import { suapSyncBodySchema, suapSyncResultSchema } from "./suap";
import {
  createTemplateBodySchema,
  importTemplateBodySchema,
  importTemplateResultSchema,
  shareCodeParamsSchema,
  sharedTemplateSchema,
  sharedTemplatesResponseSchema,
  templateIdParamsSchema,
  templatePreviewSchema,
} from "./sharing";

const notFound = {
  description: "Código inexistente, expirado, revogado ou esgotado (TEMPLATE_NOT_FOUND)",
};

export const sharingRoutes = {
  importSpreadsheet: {
    method: "POST",
    path: "/v1/imports/semester",
    summary:
      "Cria um semestre completo (matérias, grade, feriados e registros) a partir da planilha exportada pelo app",
    tag: "Compartilhamento",
    auth: true,
    idempotent: true,
    request: { body: semesterImportBodySchema },
    responses: {
      201: { description: "Semestre criado", schema: semesterImportResultSchema },
      422: { description: "Dados inválidos (com o campo e a linha do problema)" },
    },
  },
  syncSuap: {
    method: "POST",
    path: "/v1/imports/suap",
    summary:
      "Cria ou atualiza um semestre com o retrato do SUAP (matérias, horários e faltas por aula)",
    tag: "Compartilhamento",
    auth: true,
    idempotent: true,
    request: { body: suapSyncBodySchema },
    responses: {
      200: { description: "Semestre atualizado ou criado", schema: suapSyncResultSchema },
      404: { description: "Semestre não encontrado" },
      422: { description: "Dados inválidos" },
    },
  },
  createTemplate: {
    method: "POST",
    path: "/v1/templates",
    summary: "Gera um código de compartilhamento a partir de um semestre ou matéria (sem faltas)",
    tag: "Compartilhamento",
    auth: true,
    request: { body: createTemplateBodySchema },
    responses: {
      201: { description: "Código criado", schema: sharedTemplateSchema },
      403: { description: "E-mail não confirmado (EMAIL_NOT_VERIFIED)" },
      409: { description: "Limite de códigos ativos (TEMPLATE_LIMIT)" },
      422: { description: "Semestre sem matérias (TEMPLATE_EMPTY) ou dados inválidos" },
    },
  },
  listTemplates: {
    method: "GET",
    path: "/v1/templates",
    summary: "Seus códigos de compartilhamento, com usos e situação",
    tag: "Compartilhamento",
    auth: true,
    responses: { 200: { description: "Códigos", schema: sharedTemplatesResponseSchema } },
  },
  revokeTemplate: {
    method: "DELETE",
    path: "/v1/templates/:id",
    summary: "Revoga um código (quem já importou continua com a cópia)",
    tag: "Compartilhamento",
    auth: true,
    request: { params: templateIdParamsSchema },
    responses: {
      204: { description: "Revogado" },
      404: { description: "Não encontrado (ou de outra pessoa)" },
    },
  },
  previewTemplate: {
    method: "GET",
    path: "/v1/templates/:code",
    summary: "Prévia pública de um modelo pelo código (sem login, com limite por IP)",
    tag: "Compartilhamento",
    auth: false,
    request: { params: shareCodeParamsSchema },
    responses: {
      200: { description: "Prévia", schema: templatePreviewSchema },
      404: notFound,
      429: { description: "Muitas consultas" },
    },
  },
  importTemplate: {
    method: "POST",
    path: "/v1/templates/:code/import",
    summary:
      "Importa o modelo: cria o semestre (ou a matéria), a grade e os feriados numa transação",
    tag: "Compartilhamento",
    auth: true,
    idempotent: true,
    request: { params: shareCodeParamsSchema, body: importTemplateBodySchema },
    responses: {
      201: { description: "Importado", schema: importTemplateResultSchema },
      404: notFound,
      422: {
        description: "Modelo de matéria sem semestre de destino (TEMPLATE_SEMESTER_REQUIRED)",
      },
    },
  },
} as const satisfies Record<string, RouteDef>;
