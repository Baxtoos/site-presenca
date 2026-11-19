import {
  acceptedResponseSchema,
  deleteMeBodySchema,
  emailBodySchema,
  loginBodySchema,
  meResponseSchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sessionIdParamsSchema,
  sessionsResponseSchema,
  tokenBodySchema,
  updateMeBodySchema,
} from "./auth";
import { academicRoutes } from "./academic-routes";
import { attendanceRoutes } from "./attendance-routes";
import { notificationRoutes } from "./notification-routes";
import { sharingRoutes } from "./sharing-routes";
import { healthResponseSchema, readinessResponseSchema } from "./health";

export type { HttpMethod, RouteDef, RouteResponse } from "./route-types";
import type { RouteDef } from "./route-types";

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

  // ---- Autenticação ----
  register: {
    method: "POST",
    path: "/v1/auth/register",
    summary:
      "Pede o cadastro: sempre aceita e manda um e-mail (link de confirmação, ou aviso de que a conta já existe)",
    tag: "Autenticação",
    auth: false,
    request: { body: registerBodySchema },
    responses: {
      202: {
        description: "Aceito (a resposta é a mesma exista ou não a conta)",
        schema: acceptedResponseSchema,
      },
      422: { description: "Dados inválidos ou senha vazada (PASSWORD_BREACHED)" },
    },
  },
  registerConfirm: {
    method: "POST",
    path: "/v1/auth/register/confirm",
    summary:
      "Confirma o cadastro pelo link do e-mail: cria a conta (e-mail já confirmado) e abre a sessão",
    tag: "Autenticação",
    auth: false,
    request: { body: tokenBodySchema },
    responses: {
      200: { description: "Conta criada e sessão aberta", schema: meResponseSchema },
      400: { description: "Link inválido, usado ou expirado (INVALID_TOKEN)" },
    },
  },
  login: {
    method: "POST",
    path: "/v1/auth/login",
    summary: "Abre sessão com e-mail e senha",
    tag: "Autenticação",
    auth: false,
    request: { body: loginBodySchema },
    responses: {
      200: { description: "Sessão aberta (cookie __Host-sid)", schema: meResponseSchema },
      401: { description: "E-mail ou senha incorretos (INVALID_CREDENTIALS)" },
    },
  },
  logout: {
    method: "POST",
    path: "/v1/auth/logout",
    summary: "Encerra a sessão atual",
    tag: "Autenticação",
    auth: true,
    responses: { 204: { description: "Sessão encerrada" } },
  },
  magicLink: {
    method: "POST",
    path: "/v1/auth/magic-link",
    summary: "Envia um link de acesso de uso único (também cria a conta, se não existir)",
    tag: "Autenticação",
    auth: false,
    request: { body: emailBodySchema },
    responses: { 202: { description: "Pedido aceito", schema: acceptedResponseSchema } },
  },
  magicLinkConsume: {
    method: "POST",
    path: "/v1/auth/magic-link/consume",
    summary: "Troca o token do link por uma sessão",
    tag: "Autenticação",
    auth: false,
    request: { body: tokenBodySchema },
    responses: {
      200: { description: "Sessão aberta", schema: meResponseSchema },
      400: { description: "Link inválido, usado ou expirado (INVALID_TOKEN)" },
    },
  },
  verifyEmail: {
    method: "POST",
    path: "/v1/auth/verify-email",
    summary: "Confirma o e-mail com o token do link",
    tag: "Autenticação",
    auth: false,
    request: { body: tokenBodySchema },
    responses: {
      204: { description: "E-mail confirmado" },
      400: { description: "Link inválido, usado ou expirado (INVALID_TOKEN)" },
    },
  },
  verifyEmailResend: {
    method: "POST",
    path: "/v1/auth/verify-email/resend",
    summary: "Reenvia o link de verificação para o e-mail da conta",
    tag: "Autenticação",
    auth: true,
    responses: { 202: { description: "Pedido aceito", schema: acceptedResponseSchema } },
  },
  passwordForgot: {
    method: "POST",
    path: "/v1/auth/password/forgot",
    summary: "Envia link de redefinição de senha (resposta igual exista ou não a conta)",
    tag: "Autenticação",
    auth: false,
    request: { body: emailBodySchema },
    responses: { 202: { description: "Pedido aceito", schema: acceptedResponseSchema } },
  },
  passwordReset: {
    method: "POST",
    path: "/v1/auth/password/reset",
    summary: "Troca a senha, encerra todas as sessões e abre uma nova",
    tag: "Autenticação",
    auth: false,
    request: { body: resetPasswordBodySchema },
    responses: {
      200: { description: "Senha trocada e sessão aberta", schema: meResponseSchema },
      400: { description: "Link inválido, usado ou expirado (INVALID_TOKEN)" },
    },
  },
  googleStart: {
    method: "GET",
    path: "/v1/auth/google",
    summary: "Redireciona para o login do Google (OAuth 2.0 com PKCE)",
    tag: "Autenticação",
    auth: false,
    responses: { 302: { description: "Redireciona para o Google" } },
  },
  googleCallback: {
    method: "GET",
    path: "/v1/auth/google/callback",
    summary: "Retorno do Google: abre sessão e redireciona para o app",
    tag: "Autenticação",
    auth: false,
    responses: { 302: { description: "Redireciona para o app (com ?erro= em caso de falha)" } },
  },

  // ---- Perfil e sessões ----
  me: {
    method: "GET",
    path: "/v1/me",
    summary: "Perfil acadêmico do usuário logado",
    tag: "Perfil",
    auth: true,
    responses: { 200: { description: "Perfil", schema: meResponseSchema } },
  },
  updateMe: {
    method: "PATCH",
    path: "/v1/me",
    summary: "Atualiza o perfil acadêmico",
    tag: "Perfil",
    auth: true,
    request: { body: updateMeBodySchema },
    responses: { 200: { description: "Perfil atualizado", schema: meResponseSchema } },
  },
  sessions: {
    method: "GET",
    path: "/v1/me/sessions",
    summary: "Sessões ativas em todos os dispositivos",
    tag: "Perfil",
    auth: true,
    responses: { 200: { description: "Sessões", schema: sessionsResponseSchema } },
  },
  revokeSession: {
    method: "DELETE",
    path: "/v1/me/sessions/:id",
    summary: "Encerra uma sessão (de qualquer dispositivo)",
    tag: "Perfil",
    auth: true,
    request: { params: sessionIdParamsSchema },
    responses: {
      204: { description: "Sessão encerrada" },
      404: { description: "Sessão não encontrada" },
    },
  },
  exportMe: {
    method: "GET",
    path: "/v1/me/export.json",
    summary: "Baixa todos os dados da conta em JSON (portabilidade / LGPD)",
    tag: "Perfil",
    auth: true,
    responses: { 200: { description: "Arquivo JSON completo com os dados do aluno" } },
  },
  deleteMe: {
    method: "DELETE",
    path: "/v1/me",
    summary: "Exclui definitivamente a conta, matérias, registros e histórico (LGPD)",
    tag: "Perfil",
    auth: true,
    request: { body: deleteMeBodySchema },
    responses: {
      204: { description: "Conta excluída e sessão encerrada" },
      400: {
        description: "Link de exclusão inválido, usado, expirado ou de outra conta (INVALID_TOKEN)",
      },
      401: { description: "Senha incorreta (INVALID_CREDENTIALS)" },
    },
  },
  deleteMeRequest: {
    method: "POST",
    path: "/v1/me/delete-request",
    summary: "Conta sem senha: envia por e-mail o link para confirmar a exclusão (vale 15 min)",
    tag: "Perfil",
    auth: true,
    responses: {
      202: { description: "Link enviado ao e-mail da conta", schema: acceptedResponseSchema },
      409: { description: "A conta tem senha: confirme digitando a senha (HAS_PASSWORD)" },
    },
  },

  // ---- Semestres, matérias, grade e feriados ----
  ...academicRoutes,

  // ---- Presença, aulas de hoje e simulador ----
  ...attendanceRoutes,

  // ---- Notificações, preferências e push ----
  ...notificationRoutes,

  // ---- Compartilhamento de grades ----
  ...sharingRoutes,
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
