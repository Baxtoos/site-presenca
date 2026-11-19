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

/** Variável opcional: string vazia (`X=` no .env) conta como não definida. */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
/** Chave de desenvolvimento do .env.example (pública: recusada em produção). */
export const DEV_MFA_KEY = "cHJlc2VuY2EtZGV2LW1mYS1uYW8tdXNlLWVtLXByb2Q=";

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalBool = z.preprocess(emptyToUndefined, z.stringbool().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    WEB_ORIGIN: z.url(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "precisa ser uma URL postgres://"),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, "precisa ser uma URL redis://"),
    TRUST_PROXY: trustProxySchema,
    /**
     * Segredo compartilhado com o app web (mesmo valor nos dois). Com ele, a API aceita o IP do
     * aluno que o proxy do app manda (ver common/client-ip.ts). Gerar: `openssl rand -base64 32`.
     */
    API_PROXY_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(32, { message: "use pelo menos 32 caracteres" }).optional(),
    ),
    /**
     * Segredo só da rota de repasse de e-mail do app web (mesmo valor nos dois), separado do
     * API_PROXY_SECRET: se um vazar, o outro continua valendo. Vazio = usa o API_PROXY_SECRET
     * (configuração antiga). Gerar: `openssl rand -base64 32`.
     */
    MAIL_RELAY_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(32, { message: "use pelo menos 32 caracteres" }).optional(),
    ),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** Publica /openapi.json. Padrão: ligado fora de produção. */
    OPENAPI_ENABLED: optionalBool,
    APP_VERSION: z.string().default("dev"),
    /** Rastreamento de erros (Sentry). Vazio = desligado. */
    SENTRY_DSN: optionalString,

    // ---- E-mail ----
    /**
     * smtp (Mailpit em desenvolvimento), resend, relay (repasse pelo app web, para o Render gratuito,
     * que bloqueia SMTP) ou log (só imprime; nunca em produção).
     */
    MAIL_TRANSPORT: z.enum(["smtp", "resend", "relay", "log"]).default("log"),
    MAIL_FROM: z.string().min(3).default("Monitor de Presenças <nao-responda@presenca.local>"),
    /** Para onde vão as sugestões e os problemas enviados pela página Conta. Vazio = desligado. */
    FEEDBACK_TO: z.preprocess(emptyToUndefined, z.email().optional()),
    SMTP_URL: optionalString,
    RESEND_API_KEY: optionalString,

    // ---- Web Push (opcional: sem a chave, o app não oferece push) ----
    /** Chave pública VAPID (a privada fica só no worker). Gerar: `npx web-push generate-vapid-keys`. */
    VAPID_PUBLIC_KEY: optionalString,

    // ---- Login com Google (opcional: sem as duas variáveis, o botão some) ----
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,

    /**
     * Chave AES-256 (32 bytes em base64) que cifra os segredos do segundo fator no banco.
     * Vazia: o segundo fator fica indisponível (a página Conta explica). Gerar:
     * `openssl rand -base64 32`. Trocar a chave invalida os apps autenticadores já ligados.
     */
    MFA_ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((v) => Buffer.from(v, "base64").length === 32, {
          message: "precisa ser 32 bytes em base64 (openssl rand -base64 32)",
        })
        .optional(),
    ),

    /** Recusa senhas que aparecem em vazamentos (Have I Been Pwned, por k-anonimato). */
    HIBP_ENABLED: optionalBool,

    /**
     * Multiplica todos os limites de tentativa. Só para desenvolvimento e testes automatizados,
     * em que tudo sai do mesmo IP (localhost). Em produção precisa ser 1.
     */
    RATE_LIMIT_FACTOR: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(1_000).default(1),
    ),
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.MFA_ENCRYPTION_KEY === DEV_MFA_KEY), {
    path: ["MFA_ENCRYPTION_KEY"],
    message: "em produção gere uma chave própria (a do .env.example é pública)",
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.RATE_LIMIT_FACTOR !== 1), {
    path: ["RATE_LIMIT_FACTOR"],
    message: "em produção os limites de tentativa não podem ser afrouxados (use 1)",
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.TRUST_PROXY === true), {
    path: ["TRUST_PROXY"],
    message: "não use true em produção; informe o número de saltos ou os IPs do proxy",
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "log"), {
    path: ["MAIL_TRANSPORT"],
    message: "em produção use resend, smtp ou relay (log imprimiria links de acesso nos logs)",
  })
  .refine((env) => env.MAIL_TRANSPORT !== "smtp" || env.SMTP_URL !== undefined, {
    path: ["SMTP_URL"],
    message: "obrigatória com MAIL_TRANSPORT=smtp",
  })
  .refine((env) => env.MAIL_TRANSPORT !== "resend" || env.RESEND_API_KEY !== undefined, {
    path: ["RESEND_API_KEY"],
    message: "obrigatória com MAIL_TRANSPORT=resend",
  })
  .refine(
    (env) =>
      env.MAIL_TRANSPORT !== "relay" ||
      env.MAIL_RELAY_SECRET !== undefined ||
      env.API_PROXY_SECRET !== undefined,
    {
      path: ["MAIL_RELAY_SECRET"],
      message: "obrigatória com MAIL_TRANSPORT=relay (é o segredo da rota de e-mail do app web)",
    },
  )
  .refine(
    (env) => env.MAIL_RELAY_SECRET === undefined || env.MAIL_RELAY_SECRET !== env.API_PROXY_SECRET,
    {
      path: ["MAIL_RELAY_SECRET"],
      message: "precisa ser diferente do API_PROXY_SECRET (a ideia é separar os dois)",
    },
  )
  .refine(
    (env) => (env.GOOGLE_CLIENT_ID === undefined) === (env.GOOGLE_CLIENT_SECRET === undefined),
    {
      path: ["GOOGLE_CLIENT_SECRET"],
      message: "defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntas (ou nenhuma)",
    },
  )
  .refine((env) => env.NODE_ENV !== "production" || new URL(env.WEB_ORIGIN).protocol === "https:", {
    path: ["WEB_ORIGIN"],
    message: "em produção o app precisa de HTTPS (o cookie de sessão é Secure)",
  })
  .transform((env) => ({
    ...env,
    OPENAPI_ENABLED: env.OPENAPI_ENABLED ?? env.NODE_ENV !== "production",
    HIBP_ENABLED: env.HIBP_ENABLED ?? env.NODE_ENV !== "test",
    /** Origem do app web, normalizada (sem barra final), para comparar com o cabeçalho Origin. */
    WEB_ORIGIN: new URL(env.WEB_ORIGIN).origin,
  }));

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol("ENV");

/** Valida o ambiente na inicialização. A API não sobe com variável faltando ou inválida. */
/**
 * Versão publicada. APP_VERSION manda; sem ela, o Render informa o commit do deploy em
 * RENDER_GIT_COMMIT (os 7 primeiros caracteres bastam); fora disso, "dev".
 */
function resolveVersion(source: NodeJS.ProcessEnv): string | undefined {
  if (source.APP_VERSION) return source.APP_VERSION;
  const commit = source.RENDER_GIT_COMMIT?.trim();
  return commit ? commit.slice(0, 7) : undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse({ ...source, APP_VERSION: resolveVersion(source) });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
