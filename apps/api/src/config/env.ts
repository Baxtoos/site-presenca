import { z } from "zod";

/**
 * Quais proxies podem informar o IP real do cliente (X-Forwarded-For).
 * "false" (padrão): nenhum, o IP é o da conexão. Número: quantos saltos confiar.
 * Lista separada por vírgula: IPs/CIDRs confiáveis. Nunca "true" em produção:
 * qualquer cliente poderia forjar o IP e driblar o rate limit.
 */
const trustProxySchema = z
  .string()
  .default("false")
  .transform((value, ctx): boolean | number | string[] => {
    const v = value.trim();
    if (v === "false" || v === "") return false;
    if (v === "true") return true;
    if (/^\d+$/.test(v)) return Number(v);
    const list = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "use false, um número de saltos ou uma lista de IPs",
      });
      return z.NEVER;
    }
    return list;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    WEB_ORIGIN: z.url(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "precisa ser uma URL postgres://"),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, "precisa ser uma URL redis://"),
    TRUST_PROXY: trustProxySchema,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** Publica /openapi.json. Padrão: ligado fora de produção. */
    OPENAPI_ENABLED: z.stringbool().optional(),
    APP_VERSION: z.string().default("dev"),
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.TRUST_PROXY === true), {
    path: ["TRUST_PROXY"],
    message: "não use true em produção; informe o número de saltos ou os IPs do proxy",
  })
  .transform((env) => ({
    ...env,
    OPENAPI_ENABLED: env.OPENAPI_ENABLED ?? env.NODE_ENV !== "production",
    /** Origem do app web, normalizada (sem barra final), para comparar com o cabeçalho Origin. */
    WEB_ORIGIN: new URL(env.WEB_ORIGIN).origin,
  }));

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol("ENV");

/** Valida o ambiente na inicialização. A API não sobe com variável faltando ou inválida. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
