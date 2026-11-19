import { scrubSentryEvent } from "@/lib/sentry-scrub";

/**
 * Rastreamento de erros no navegador (Sentry), só com NEXT_PUBLIC_SENTRY_DSN configurada no build.
 * Sem a variável, o SDK nem é baixado. Sem replay, sem rastreio de desempenho, sem dados pessoais.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs")
    .then((Sentry) =>
      Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        initialScope: { tags: { service: "web-browser" } },
        beforeSend: (event) => scrubSentryEvent(event),
      }),
    )
    .catch(() => {
      // Sem o Sentry o app funciona igual; não atrapalha quem usa.
    });
}
