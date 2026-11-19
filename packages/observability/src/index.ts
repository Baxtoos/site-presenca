import * as Sentry from "@sentry/node";

/**
 * Rastreamento de erros com o Sentry, só quando SENTRY_DSN está configurada (sem ela, as funções
 * não fazem nada). Só erros: sem rastreio de desempenho, sem replay, sem dados pessoais.
 *
 * LGPD: nada de corpo de requisição (senhas, observações), cookies, cabeçalhos de autenticação,
 * IP ou usuário; e-mails que aparecerem em mensagens de erro são mascarados antes do envio.
 */
let enabled = false;

const EMAIL = /[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+/g;
const SENSITIVE_HEADERS = /^(cookie|authorization|x-presenca-.*|x-api-key|proxy-authorization)$/i;

/** Remove dados pessoais e segredos de um evento antes de sair do servidor. Exportada para teste. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.test(name)) delete event.request.headers[name];
      }
    }
  }
  if (event.message) event.message = event.message.replace(EMAIL, "<e-mail>");
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = ex.value.replace(EMAIL, "<e-mail>");
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = crumb.message.replace(EMAIL, "<e-mail>");
    delete crumb.data;
  }
  return event;
}

export function initErrorReporting(options: {
  dsn: string | undefined;
  service: "api" | "worker";
  environment: string;
  release?: string;
}): boolean {
  if (!options.dsn) return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    serverName: options.service,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Só o essencial: sem instrumentação automática de HTTP/banco (não precisamos de rastreio).
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    initialScope: { tags: { service: options.service } },
    beforeSend: (event) => scrubEvent(event),
  });
  enabled = true;
  return true;
}

/** Envia um erro ao Sentry (se configurado), com contexto sem dados pessoais. */
export function reportError(error: unknown, context: Record<string, string | number> = {}): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: context });
}

/** Espera os envios pendentes (antes de o processo sair). */
export async function flushErrors(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
