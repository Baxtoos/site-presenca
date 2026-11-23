import type { RouteDef } from "./route-types";
import {
  createTaskBodySchema,
  taskListQuerySchema,
  taskListSchema,
  taskParamsSchema,
  taskSchema,
  updateTaskBodySchema,
} from "./tasks";

const notFound = { description: "Tarefa não encontrada (ou de outra pessoa)" };

export const taskRoutes = {
  listTasks: {
    method: "GET",
    path: "/v1/tasks",
    summary: "Tarefas e entregas, filtradas por status e matéria, por proximidade do prazo",
    tag: "Tarefas",
    auth: true,
    request: { query: taskListQuerySchema },
    responses: { 200: { description: "Tarefas", schema: taskListSchema } },
  },
  createTask: {
    method: "POST",
    path: "/v1/tasks",
    summary: "Cadastra uma tarefa (prazo no fuso da conta e antecedência do aviso)",
    tag: "Tarefas",
    auth: true,
    idempotent: true,
    request: { body: createTaskBodySchema },
    responses: {
      201: { description: "Criada (ETag com a versão)", schema: taskSchema },
      422: { description: "Dados inválidos ou matéria que não é sua (TASK_INVALID)" },
    },
  },
  getTask: {
    method: "GET",
    path: "/v1/tasks/:id",
    summary: "Uma tarefa (ETag com a versão)",
    tag: "Tarefas",
    auth: true,
    request: { params: taskParamsSchema },
    responses: { 200: { description: "Tarefa", schema: taskSchema }, 404: notFound },
  },
  updateTask: {
    method: "PATCH",
    path: "/v1/tasks/:id",
    summary: "Edita a tarefa ou marca como concluída / não concluída (cancela avisos pendentes)",
    tag: "Tarefas",
    auth: true,
    ifMatch: true,
    request: { params: taskParamsSchema, body: updateTaskBodySchema },
    responses: {
      200: { description: "Atualizada (ETag com a versão nova)", schema: taskSchema },
      404: notFound,
      412: { description: "Outra edição salvou antes (VERSION_MISMATCH)" },
      422: { description: "Dados inválidos (TASK_INVALID)" },
    },
  },
  deleteTask: {
    method: "DELETE",
    path: "/v1/tasks/:id",
    summary: "Apaga a tarefa (cancela avisos pendentes; o histórico de avisos fica)",
    tag: "Tarefas",
    auth: true,
    ifMatch: true,
    request: { params: taskParamsSchema },
    responses: {
      204: { description: "Apagada" },
      404: notFound,
      412: { description: "Versão desatualizada" },
    },
  },
} as const satisfies Record<string, RouteDef>;
