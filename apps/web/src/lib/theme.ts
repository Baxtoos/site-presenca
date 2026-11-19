/**
 * Tema do app: "system" segue o aparelho; "light"/"dark" fixam. A escolha fica no aparelho
 * (localStorage), como o tema de um app nativo, e vale para todas as contas dele.
 *
 * O tema fixo vai em <html data-theme>, que o globals.css usa para trocar as cores. Um script
 * inline no <head> aplica a escolha antes da primeira pintura, para a tela não piscar.
 */
export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "presenca:tema";

/** Cor da barra do navegador/app instalado em cada tema (mesmos valores do --color-paper). */
export const THEME_COLOR = { light: "#ffffff", dark: "#191919" } as const;

export const THEME_SCRIPT = `(function () {
  var t = null;
  try { t = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch (e) {}
  if (t !== "light" && t !== "dark") return;
  document.documentElement.setAttribute("data-theme", t);
  var color = t === "dark" ? ${JSON.stringify(THEME_COLOR.dark)} : ${JSON.stringify(THEME_COLOR.light)};
  document.addEventListener("DOMContentLoaded", function () {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
  });
})();`;

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Sem armazenamento: vale o que foi aplicado nesta página.
    const applied = document.documentElement.getAttribute("data-theme");
    return applied === "light" || applied === "dark" ? applied : "system";
  }
}

const listeners = new Set<() => void>();

/** Para useSyncExternalStore: avisa quando o tema muda nesta aba ou em outra. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Aplica e guarda a escolha. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Sem armazenamento (aba anônima bloqueada): o tema vale até fechar a página.
  }
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    // Automático: cada meta volta à cor do seu tema (elas têm media de claro e de escuro).
    const dark =
      theme === "system" ? (meta.getAttribute("media") ?? "").includes("dark") : theme === "dark";
    meta.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  }
  for (const listener of listeners) listener();
}
