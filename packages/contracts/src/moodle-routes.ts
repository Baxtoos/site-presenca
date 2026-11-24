import {
  moodleConnectBodySchema,
  moodleCourseBodySchema,
  moodleCourseParamsSchema,
  moodleCourseSchema,
  moodleDisconnectQuerySchema,
  moodleStatusSchema,
  moodleSyncResultSchema,
} from "./moodle";
import type { RouteDef } from "./route-types";

const unavailable = { description: "Integração desligada no servidor (MOODLE_UNAVAILABLE)" };
const notConnected = { description: "Moodle não conectado (MOODLE_NOT_CONNECTED)" };

export const moodleRoutes = {
  getMoodle: {
    method: "GET",
    path: "/v1/moodle",
    summary: "Estado da conexão com o Moodle (sem link nem chave) e as turmas encontradas",
    tag: "Moodle",
    auth: true,
    responses: { 200: { description: "Estado", schema: moodleStatusSchema } },
  },
  connectMoodle: {
    method: "PUT",
    path: "/v1/moodle",
    summary:
      "Conecta ou atualiza (link .ics, endereço e chave): testa, guarda cifrado e sincroniza",
    tag: "Moodle",
    auth: true,
    request: { body: moodleConnectBodySchema },
    responses: {
      200: { description: "Conectado e sincronizado", schema: moodleSyncResultSchema },
      422: { description: "Link ou chave recusados pelo Moodle (MOODLE_INVALID)" },
      429: { description: "Tentativas demais" },
      503: unavailable,
    },
  },
  syncMoodle: {
    method: "POST",
    path: "/v1/moodle/sync",
    summary: "Sincroniza agora (limite por hora)",
    tag: "Moodle",
    auth: true,
    idempotent: true,
    responses: {
      200: { description: "Sincronizado", schema: moodleSyncResultSchema },
      404: notConnected,
      422: { description: "O Moodle recusou (MOODLE_INVALID)" },
      429: { description: "Sincronizações demais" },
      503: unavailable,
    },
  },
  updateMoodleCourse: {
    method: "PATCH",
    path: "/v1/moodle/courses/:id",
    summary: "Liga a turma a uma matéria ou ignora a turma (atualiza as tarefas importadas)",
    tag: "Moodle",
    auth: true,
    ifMatch: true,
    request: { params: moodleCourseParamsSchema, body: moodleCourseBodySchema },
    responses: {
      200: { description: "Turma atualizada (ETag)", schema: moodleCourseSchema },
      404: { description: "Turma não encontrada" },
      412: { description: "Versão desatualizada" },
      422: { description: "Matéria que não é sua (MOODLE_INVALID)" },
    },
  },
  disconnectMoodle: {
    method: "DELETE",
    path: "/v1/moodle",
    summary: "Desconecta: mantém as tarefas como manuais ou apaga as futuras pendentes",
    tag: "Moodle",
    auth: true,
    ifMatch: true,
    request: { query: moodleDisconnectQuerySchema },
    responses: {
      204: { description: "Desconectado (link e chave apagados)" },
      404: notConnected,
      412: { description: "Versão desatualizada" },
    },
  },
} as const satisfies Record<string, RouteDef>;
