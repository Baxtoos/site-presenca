import { z } from "zod";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

// O Zod testa se pode usar `new Function` para validar mais rápido; a CSP do site (sem eval)
// bloqueia, e cada teste vira um alerta de violação. Sem JIT, valida igual, só sem o atalho.
z.config({ jitless: true });

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs")
    .then((Sentry) =>
      Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
        release: process.env.NEXT_PUBLIC_APP_VERSION,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        initialScope: { tags: { service: "web-browser" } },
        beforeSend: (event) => scrubSentryEvent(event),
      }),
    )
    .catch(() => {});
}
