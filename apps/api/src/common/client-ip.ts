import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

/**
 * IP real do aluno quando a API está atrás do app web (Vercel → Cloudflare → Render).
 *
 * Contar saltos de X-Forwarded-For não serve aí: a Vercel reescreve o cabeçalho e a Cloudflare
 * do Render acrescenta os próprios IPs, então `request.ip` vira um IP da Cloudflare, o mesmo para
 * todo mundo, e o rate limit por IP passa a punir todos os alunos juntos.
 *
 * Por isso o proxy do app web (apps/web/src/proxy.ts) manda o IP que a Vercel viu num cabeçalho
 * próprio, junto com um segredo compartilhado. Só com o segredo certo o cabeçalho vale; sem ele
 * (chamada direta à API, segredo não configurado) fica o `request.ip` de sempre.
 */
export const CLIENT_IP_HEADER = "x-presenca-client-ip";
export const PROXY_SECRET_HEADER = "x-presenca-proxy-secret";

declare module "fastify" {
  interface FastifyRequest {
    clientIp: string;
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function sameSecret(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

export function resolveClientIp(request: FastifyRequest, proxySecret: string | undefined): string {
  const secret = request.headers[PROXY_SECRET_HEADER];
  const forwarded = request.headers[CLIENT_IP_HEADER];
  // Nunca deixa os cabeçalhos seguirem adiante (logs, handlers): o segredo não pode vazar.
  delete request.headers[PROXY_SECRET_HEADER];
  delete request.headers[CLIENT_IP_HEADER];

  if (
    proxySecret !== undefined &&
    typeof secret === "string" &&
    typeof forwarded === "string" &&
    sameSecret(secret, proxySecret)
  ) {
    const ip = forwarded.trim();
    if (isIP(ip) !== 0) return ip;
  }
  return request.ip;
}
