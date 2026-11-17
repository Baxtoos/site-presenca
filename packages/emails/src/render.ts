import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Renderiza um template para HTML estático, pronto para o provedor de e-mail. */
export function renderEmail(element: ReactElement): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(element)}`;
}
