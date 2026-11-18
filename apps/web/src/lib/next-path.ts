/**
 * Para onde voltar depois de entrar ou criar a conta (`?next=/importar/ABCD2345`).
 * Só caminhos do próprio app: nada de "//outro-site", "/\\outro-site" ou "https://...", que
 * transformariam o login num redirecionamento aberto.
 */
export function safeNext(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (value.length > 300) return null;
  try {
    const url = new URL(value, "https://app.invalid");
    if (url.origin !== "https://app.invalid") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** "/entrar" + next → "/entrar?next=%2Fimportar%2F..." (ou só "/entrar"). */
export const withNext = (path: string, next: string | null) =>
  next ? `${path}?next=${encodeURIComponent(next)}` : path;
