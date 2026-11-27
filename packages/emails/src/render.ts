import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function renderEmail(element: ReactElement): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(element)}`;
}
