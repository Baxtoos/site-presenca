"use client";

import type { Problem } from "@presenca/contracts";

/** Erro de uma chamada à API, já no formato problem+json. */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }

  get code(): string {
    return this.problem.code;
  }

  /** Mensagens por campo (validação), para mostrar embaixo de cada input. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

const NETWORK_PROBLEM: Problem = {
  type: "about:blank",
  status: 0,
  code: "NETWORK_ERROR",
  title: "Sem conexão",
  detail: "Não foi possível falar com o servidor. Confira sua internet e tente de novo.",
};

/**
 * Chamada do navegador para a API, sempre pelo proxy /api do próprio app (mesmo domínio):
 * o cookie de sessão vai junto e nenhuma credencial fica no front.
 */
export async function api<T>(
  path: `/v1/${string}`,
  init: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    /** Versão que está sendo editada (vai no If-Match). A API responde 412 se outro salvou antes. */
    ifMatch?: number;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.ifMatch !== undefined) headers["if-match"] = `"${init.ifMatch}"`;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(NETWORK_PROBLEM);
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = (body as Problem | null) ?? {
      ...NETWORK_PROBLEM,
      status: response.status,
      code: `HTTP_${response.status}`,
      detail: "O servidor respondeu com um erro inesperado.",
    };
    throw new ApiError(problem);
  }
  return body as T;
}
