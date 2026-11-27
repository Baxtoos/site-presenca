/**
 * Content-Security-Policy das páginas, com nonce por requisição (gerado em src/proxy.ts).
 *
 * Scripts: só os que trazem o nonce desta resposta (os do Next, que ele marca sozinho, e os dois
 * scripts inline do app: tema e máscara da barra) e os que eles carregam ('strict-dynamic').
 * Um script injetado por um atacante não sabe o nonce e não roda. Sem 'unsafe-inline'.
 *
 * Estilos continuam com 'unsafe-inline' (atributos style do React); isso não executa código.
 */
export function contentSecurityPolicy(nonce: string, opts: { sentry: boolean; dev: boolean }) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${opts.sentry ? " https://*.sentry.io" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
