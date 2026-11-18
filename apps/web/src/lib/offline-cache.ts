"use client";

import { idbStore } from "./offline-queue";

/** Mesmo nome usado em public/sw.js. */
const PAGES_CACHE = "presenca-pages";
const LAST_USER_KEY = "presenca:last-user";

/** O service worker só roda no build de produção (ou com NEXT_PUBLIC_SW=1, para testar). */
export const SW_ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW === "1";

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (!SW_ENABLED) {
    // Em dev, um SW que sobrou de um teste de produção serviria arquivos velhos: tira.
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    return;
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** Apaga as páginas guardadas para uso offline (têm dados do aluno logado). */
export async function clearPagesCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(PAGES_CACHE);
}

/**
 * Chamado ao entrar na área logada: se o aparelho estava com outra conta, as páginas guardadas
 * eram dela e não podem aparecer para esta pessoa (nem offline).
 */
export async function rememberUser(userId: string): Promise<void> {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_USER_KEY);
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // Armazenamento bloqueado (aba anônima restrita): na dúvida, limpa.
  }
  if (last !== userId) await clearPagesCache();
}

/** Ao sair: some com as páginas guardadas e com as marcações ainda não enviadas desta conta. */
export async function clearOfflineData(userId: string): Promise<void> {
  await clearPagesCache();
  const store = idbStore();
  const marks = await store.all();
  await Promise.all(marks.filter((m) => m.userId === userId).map((m) => store.delete(m.key)));
}
