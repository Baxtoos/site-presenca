import { idParamsSchema } from "./academic";
import {
  evaluationItemParamsSchema,
  saveGradingBodySchema,
  scoreBodySchema,
  subjectGradingSchema,
} from "./grades";
import type { RouteDef } from "./route-types";

const notFound = { description: "Matéria ou avaliação não encontrada (ou de outra pessoa)" };

export const gradeRoutes = {
  getGrading: {
    method: "GET",
    path: "/v1/subjects/:id/grading",
    summary: "Regra de cálculo, avaliações com notas e o resumo (garantida, parcial, quanto falta)",
    tag: "Notas",
    auth: true,
    request: { params: idParamsSchema },
    responses: {
      200: { description: "Notas da matéria", schema: subjectGradingSchema },
      404: notFound,
    },
  },
  saveGrading: {
    method: "PUT",
    path: "/v1/subjects/:id/grading",
    summary:
      "Salva a regra e a lista de avaliações (mantém as notas das que continuam; If-Match quando já existe)",
    tag: "Notas",
    auth: true,
    request: { params: idParamsSchema, body: saveGradingBodySchema },
    responses: {
      200: { description: "Salvo (ETag com a versão da regra)", schema: subjectGradingSchema },
      404: notFound,
      412: { description: "Outra edição salvou antes" },
      422: { description: "Regra inválida (GRADING_INVALID), com o campo" },
      428: { description: "Falta o If-Match (a regra já existe)" },
    },
  },
  setScore: {
    method: "PATCH",
    path: "/v1/evaluation-items/:id",
    summary: "Lança, corrige ou apaga a nota de uma avaliação (vira nota do aluno)",
    tag: "Notas",
    auth: true,
    ifMatch: true,
    request: { params: evaluationItemParamsSchema, body: scoreBodySchema },
    responses: {
      200: {
        description: "Notas da matéria, com o resumo recalculado",
        schema: subjectGradingSchema,
      },
      404: notFound,
      412: { description: "Versão desatualizada" },
      422: { description: "Nota acima da máxima" },
    },
  },
} as const satisfies Record<string, RouteDef>;
