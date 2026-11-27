import type { Problem } from "@presenca/contracts";

export const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

const BY_STATUS: Record<number, { code: string; title: string }> = {
  400: { code: "BAD_REQUEST", title: "Requisição malformada" },
  401: { code: "UNAUTHENTICATED", title: "Sessão ausente ou expirada" },
  403: { code: "FORBIDDEN", title: "Acesso negado" },
  404: { code: "NOT_FOUND", title: "Recurso não encontrado" },
  405: { code: "METHOD_NOT_ALLOWED", title: "Método não permitido" },
  409: { code: "CONFLICT", title: "Conflito com o estado atual" },
  412: { code: "PRECONDITION_FAILED", title: "Versão desatualizada" },
  413: { code: "PAYLOAD_TOO_LARGE", title: "Corpo da requisição grande demais" },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", title: "Tipo de conteúdo não suportado" },
  422: { code: "VALIDATION_FAILED", title: "Dados inválidos" },
  429: { code: "RATE_LIMITED", title: "Muitas requisições" },
  500: { code: "INTERNAL_ERROR", title: "Erro interno" },
  503: { code: "SERVICE_UNAVAILABLE", title: "Serviço indisponível" },
};

export function defaultsFor(status: number): { code: string; title: string } {
  return (
    BY_STATUS[status] ??
    (status >= 500 ? BY_STATUS[500]! : { code: `HTTP_${status}`, title: "Erro na requisição" })
  );
}

export function buildProblem(
  status: number,
  options: Partial<Pick<Problem, "code" | "title" | "detail" | "errors">> & { requestId?: string },
): Problem {
  const base = defaultsFor(status);
  return {
    type: "about:blank",
    status,
    code: options.code ?? base.code,
    title: options.title ?? base.title,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.errors ? { errors: options.errors } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
  };
}
