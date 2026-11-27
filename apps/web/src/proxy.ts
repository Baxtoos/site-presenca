import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy, generateNonce } from "@/lib/csp";

/**
 * Repassa à API o IP real do aluno (ver apps/api/src/common/client-ip.ts).
 *
 * Na Vercel, `x-real-ip` é o IP de quem abriu o site, e a própria Vercel sobrescreve o valor
 * (o cliente não consegue forjar). A API só aceita o cabeçalho junto com API_PROXY_SECRET, o
 * mesmo valor configurado nos dois lados. Sem o segredo, nada muda: a API usa o IP da conexão.
 */
const CLIENT_IP_HEADER = "x-presenca-client-ip";
const PROXY_SECRET_HEADER = "x-presenca-proxy-secret";

const SESSION_COOKIE = "__Host-sid";

function page(request: NextRequest) {
  const nonce = generateNonce();
  const policy = contentSecurityPolicy(nonce, {
    sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    dev: process.env.NODE_ENV === "development",
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  const landing = request.nextUrl.pathname === "/" && !request.cookies.has(SESSION_COOKIE);
  const response = landing
    ? NextResponse.rewrite(new URL("/apresentacao", request.url), { request: { headers } })
    : NextResponse.next({ request: { headers } });
  if (landing) response.headers.set("x-presenca-publica", "1");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Content-Security-Policy", policy);
  }
  return response;
}

function api(request: NextRequest) {
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

export function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith("/api/") ? api(request) : page(request);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!api/|_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|icon\\.svg|apple-icon\\.png|favicon\\.ico|interno/|suap\\.js).*)",
  ],
};
