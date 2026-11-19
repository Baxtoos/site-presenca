import { resolve } from "node:path";
import type { NextConfig } from "next";

const repoRoot = resolve(__dirname, "../..");

// O navegador chama /api/* no mesmo domínio; o Next repassa para a API.
// Assim não há CORS, o cookie de sessão fica restrito ao app e nenhum segredo vai para o cliente.
const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Cabeçalhos de segurança de tudo. A Content-Security-Policy das páginas sai do src/proxy.ts,
 * com um nonce por resposta (lib/csp.ts); arquivos estáticos e JSON não precisam dela.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HTTPS obrigatório por 2 anos; só em produção para não afetar o localhost.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  // Versão publicada (commit do deploy na Vercel): identifica o release nos relatórios do Sentry.
  env: { NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" },
  // Envio SMTP do repasse de e-mail (app/interno/email): o nodemailer roda como pacote do Node.
  serverExternalPackages: ["nodemailer"],
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // O service worker nunca fica em cache HTTP: uma versão nova chega na próxima visita.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default config;
