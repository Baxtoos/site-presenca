/**
 * Limpeza dos eventos do Sentry no site (navegador e servidor do Next), igual à da API:
 * sem usuário, IP, cookies, corpo de requisição nem consulta da URL; e-mails mascarados.
 */
const EMAIL = /[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+/g;

interface ScrubbableEvent {
  user?: unknown;
  message?: string;
  request?: {
    data?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    headers?: Record<string, string>;
  };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string; data?: unknown }[];
}

export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (/^(cookie|authorization|x-presenca-.*)$/i.test(name))
          delete event.request.headers[name];
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
