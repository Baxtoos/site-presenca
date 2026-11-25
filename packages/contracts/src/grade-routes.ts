import { idParamsSchema } from "./academic";
import {
  evaluationItemParamsSchema,
  gradingAssistantRequestSchema,
  gradingAssistantResponseSchema,
  moodleGradeLinksBodySchema,
  moodleGradesSchema,
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
  gradingAssistant: {
    method: "POST",
    path: "/v1/subjects/:id/grading/assistant",
    summary:
      "Assistente de IA: conversa até 10 vezes e devolve uma pergunta, a regra para conferir ou o aviso para usar o editor manual",
    tag: "Notas",
    auth: true,
    request: { params: idParamsSchema, body: gradingAssistantRequestSchema },
    responses: {
      200: {
        description: "Pergunta, regra proposta ou fallback",
        schema: gradingAssistantResponseSchema,
      },
      404: notFound,
      429: { description: "Conversas demais hoje" },
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
  getMoodleGrades: {
    method: "GET",
    path: "/v1/subjects/:id/moodle-grades",
    summary:
      "Itens do livro de notas do Moodle da turma ligada a esta matéria, com a avaliação ligada ou sugerida",
    tag: "Notas",
    auth: true,
    request: { params: idParamsSchema },
    responses: {
      200: {
        description: "Itens do Moodle (ou o motivo de não estar disponível)",
        schema: moodleGradesSchema,
      },
      404: notFound,
      429: { description: "Consultas demais ao Moodle" },
    },
  },
  linkMoodleGrades: {
    method: "PUT",
    path: "/v1/subjects/:id/moodle-grades",
    summary:
      "Liga (ou desliga) avaliações a itens do Moodle; as ligadas sem nota do aluno passam a seguir o Moodle",
    tag: "Notas",
    auth: true,
    request: { params: idParamsSchema, body: moodleGradeLinksBodySchema },
    responses: {
      200: { description: "Itens do Moodle atualizados", schema: moodleGradesSchema },
      404: notFound,
      422: { description: "Avaliação de outra matéria" },
      429: { description: "Consultas demais ao Moodle" },
    },
  },
} as const satisfies Record<string, RouteDef>;
