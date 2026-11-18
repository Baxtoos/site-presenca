import { type NextRequest, NextResponse } from "next/server";

/**
 * Repassa à API o IP real do aluno (ver apps/api/src/common/client-ip.ts).
 *
 * Na Vercel, `x-real-ip` é o IP de quem abriu o site, e a própria Vercel sobrescreve o valor
 * (o cliente não consegue forjar). A API só aceita o cabeçalho junto com API_PROXY_SECRET, o
 * mesmo valor configurado nos dois lados. Sem o segredo, nada muda: a API usa o IP da conexão.
 */
const CLIENT_IP_HEADER = "x-presenca-client-ip";
const PROXY_SECRET_HEADER = "x-presenca-proxy-secret";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Valores vindos do navegador nunca passam adiante.
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);

  const secret = process.env.API_PROXY_SECRET;
  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (secret && ip) {
    headers.set(CLIENT_IP_HEADER, ip);
    headers.set(PROXY_SECRET_HEADER, secret);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Só as chamadas à API (reescritas para o Render em next.config.ts).
  matcher: "/api/:path*",
};
