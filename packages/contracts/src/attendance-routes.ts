import {
  attendanceDeletedSchema,
  attendanceListQuerySchema,
  attendanceListSchema,
  attendanceParamsSchema,
  attendanceResultSchema,
  createAttendanceBodySchema,
  simulateResponseSchema,
  todayQuerySchema,
  todayResponseSchema,
  updateAttendanceBodySchema,
} from "./attendance";
import { idParamsSchema } from "./academic";
import type { RouteDef } from "./route-types";

const notFound = { description: "Não encontrado (ou de outra pessoa)" };

export const attendanceRoutes = {
  today: {
    method: "GET",
    path: "/v1/today",
    summary: "Aulas do dia no fuso do aluno, com o que já foi registrado",
    tag: "Presença",
    auth: true,
    request: { query: todayQuerySchema },
    responses: { 200: { description: "Aulas do dia", schema: todayResponseSchema } },
  },
  createAttendance: {
    method: "POST",
    path: "/v1/attendance",
    summary: "Registra presença, falta, falta parcial ou aula cancelada",
    tag: "Presença",
    auth: true,
    idempotent: true,
    request: { body: createAttendanceBodySchema },
    responses: {
      201: {
        description: "Registrado, com o resumo da matéria recalculado",
        schema: attendanceResultSchema,
      },
      409: { description: "Esta aula já tem registro (ATTENDANCE_CONFLICT)" },
      422: { description: "Data no futuro, fora do semestre, ou dados inconsistentes" },
    },
  },
  updateAttendance: {
    method: "PATCH",
    path: "/v1/attendance/:id",
    summary: "Corrige um registro (status, tempos perdidos, atestado, motivo, observação)",
    tag: "Presença",
    auth: true,
    ifMatch: true,
    request: { params: attendanceParamsSchema, body: updateAttendanceBodySchema },
    responses: {
      200: { description: "Atualizado", schema: attendanceResultSchema },
      404: notFound,
    },
  },
  deleteAttendance: {
    method: "DELETE",
    path: "/v1/attendance/:id",
    summary: "Apaga um registro (usado também pelo desfazer)",
    tag: "Presença",
    auth: true,
    ifMatch: true,
    request: { params: attendanceParamsSchema },
    responses: {
      200: { description: "Apagado, com o resumo recalculado", schema: attendanceDeletedSchema },
      404: notFound,
    },
  },
  listAttendance: {
    method: "GET",
    path: "/v1/subjects/:id/attendance",
    summary: "Histórico da matéria, do mais recente ao mais antigo, paginado por cursor",
    tag: "Presença",
    auth: true,
    request: { params: idParamsSchema, query: attendanceListQuerySchema },
    responses: { 200: { description: "Registros", schema: attendanceListSchema }, 404: notFound },
  },
  simulate: {
    method: "GET",
    path: "/v1/subjects/:id/simulate",
    summary: 'Simulador "Posso faltar?": próxima aula e quantas dá para faltar no calendário real',
    tag: "Presença",
    auth: true,
    request: { params: idParamsSchema },
    responses: { 200: { description: "Simulação", schema: simulateResponseSchema }, 404: notFound },
  },
} as const satisfies Record<string, RouteDef>;
