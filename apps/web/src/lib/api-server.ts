import "server-only";
import { type MeResponse, meResponseSchema } from "@presenca/contracts";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { z } from "zod";

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Chamada do servidor do Next para a API, repassando o cookie do navegador.
 * O web nunca fala com o banco: até "quem está logado" é perguntado à API.
 */
async function serverFetch(path: `/v1/${string}`): Promise<Response> {
  const store = await cookies();
  return fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: { cookie: store.toString() },
    signal: AbortSignal.timeout(5_000),
  });
}

/** Usuário logado, ou null se não houver sessão válida. Outros erros sobem. */
export async function getMe(): Promise<MeResponse | null> {
  const response = await serverFetch("/v1/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`API respondeu ${response.status} em /v1/me`);
  return meResponseSchema.parse(await response.json());
}

/**
 * GET autenticado e validado pelo schema do contrato. 401 manda para o login; 404 mostra a
 * página de "não encontrado" (inclusive para recurso de outra pessoa, que a API esconde).
 */
export async function apiGet<S extends z.ZodType>(
  path: `/v1/${string}`,
  schema: S,
): Promise<z.output<S>> {
  const response = await serverFetch(path);
  if (response.status === 401) redirect("/entrar");
  // 422 num GET é id malformado na URL (ex.: /materias/abc): para quem navega, não existe.
  if (response.status === 404 || response.status === 422) notFound();
  if (!response.ok) throw new Error(`API respondeu ${response.status} em ${path}`);
  return schema.parse(await response.json());
}
