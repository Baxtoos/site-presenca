import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    WORKER_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "precisa ser uma URL postgres://"),
    WORKER_MODE: z.enum(["loop", "once"]).default("loop"),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
    WEB_ORIGIN: z.url().transform((v) => v.replace(/\/+$/, "")),

    MAIL_TRANSPORT: z.enum(["smtp", "resend", "log"]).default("log"),
    MAIL_FROM: z.string().min(3).default("Monitor de Presenças <nao-responda@presenca.local>"),
    SMTP_URL: optionalString,
    RESEND_API_KEY: optionalString,

    INTEGRATION_ENCRYPTION_KEY: optionalString,
    INTEGRATIONS_ALLOW_INSECURE_FETCH: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    SENTRY_DSN: optionalString,

    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    VAPID_SUBJECT: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^(mailto:|https:\/\/)/, "use mailto:... ou https://...")
        .default("mailto:nao-responda@presenca.local"),
    ),
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "log"), {
    path: ["MAIL_TRANSPORT"],
    message: "em produção os e-mails precisam ser enviados de verdade (smtp ou resend)",
  })
  .refine((env) => env.MAIL_TRANSPORT !== "smtp" || env.SMTP_URL !== undefined, {
    path: ["SMTP_URL"],
    message: "obrigatória com MAIL_TRANSPORT=smtp",
  })
  .refine((env) => env.MAIL_TRANSPORT !== "resend" || env.RESEND_API_KEY !== undefined, {
    path: ["RESEND_API_KEY"],
    message: "obrigatória com MAIL_TRANSPORT=resend",
  })
  .refine((env) => !env.INTEGRATIONS_ALLOW_INSECURE_FETCH || env.NODE_ENV === "test", {
    path: ["INTEGRATIONS_ALLOW_INSECURE_FETCH"],
    message: "só com NODE_ENV=test (fora dos testes abriria brecha de SSRF)",
  })
  .refine((env) => (env.VAPID_PUBLIC_KEY === undefined) === (env.VAPID_PRIVATE_KEY === undefined), {
    path: ["VAPID_PRIVATE_KEY"],
    message: "informe as duas chaves VAPID (pública e privada) ou nenhuma",
  });

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
