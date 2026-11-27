import { suapCollector } from "@/lib/suap-collector";

/**
 * Código do favorito do SUAP, carregado pelo favorito curto (ver suapBookmarklet). Roda dentro do
 * SUAP; o endereço do Monitor vem do próprio <script> (document.currentScript), não do Host da
 * requisição. Servido sempre fresco: o favorito salvo no celular passa a ter a versão nova sozinho.
 */
const body = `(${suapCollector.toString()})(new URL(document.currentScript.src).origin);\n`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
