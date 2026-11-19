import type { Instrumentation } from "next";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

/**
 * Rastreamento de erros do servidor do site (Sentry), só com NEXT_PUBLIC_SENTRY_DSN configurada.
 * Só erros: sem rastreio de desempenho, sem dados pessoais (ver lib/sentry-scrub.ts).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { service: "web" } },
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
