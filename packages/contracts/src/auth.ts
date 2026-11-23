import { z } from "zod";

/** E-mail normalizado: sem espaços nas pontas e em minúsculas (o banco exige minúsculas). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Informe um e-mail válido." }).max(254));

/**
 * Senha: 8 a 128 caracteres (mínimo do NIST SP 800-63B; senhas vazadas continuam recusadas). O
 * teto evita requisições caras de propósito (Argon2 é lento).
 */
export const passwordSchema = z
  .string()
  .min(8, { error: "A senha precisa ter pelo menos 8 caracteres." })
  .max(128, { error: "A senha pode ter no máximo 128 caracteres." });

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Informe seu nome." })
  .max(120, { error: "O nome pode ter no máximo 120 caracteres." });

let knownTimezones: Set<string> | undefined;
export function isValidTimezone(value: string): boolean {
  knownTimezones ??= new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);
  return knownTimezones.has(value);
}

export const timezoneSchema = z.string().refine(isValidTimezone, {
  error: "Fuso horário desconhecido (use o formato America/Sao_Paulo).",
});

/** Token de link (verificação, redefinição, magic link): 32 bytes em base64url. */
export const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, { error: "Link inválido ou incompleto." });

// ---- Corpos de requisição ----

/**
 * Caminho do próprio app para onde voltar depois de confirmar (ex.: a importação de uma grade).
 * Nada de "//outro-site" ou "\\": o link do e-mail não pode virar um redirecionamento aberto.
 */
export const nextPathSchema = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[^\s\\]*$/, { error: "Caminho de retorno inválido." });

/**
 * Cadastro: sempre responde "aceito" e manda um e-mail. A conta só é criada quando a pessoa
 * confirma pelo link (POST /v1/auth/register/confirm), então a resposta não revela se o e-mail
 * já tem conta.
 */
export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  next: nextPathSchema.optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  // No login não se valida o tamanho mínimo: a mensagem de erro é sempre a mesma.
  password: z.string().min(1, { error: "Informe a senha." }).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const emailBodySchema = z.object({ email: emailSchema });
export type EmailBody = z.infer<typeof emailBodySchema>;

export const tokenBodySchema = z.object({ token: tokenSchema });
export type TokenBody = z.infer<typeof tokenBodySchema>;

export const resetPasswordBodySchema = z.object({ token: tokenSchema, password: passwordSchema });
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

export const updateMeBodySchema = z
  .object({
    fullName: fullNameSchema,
    institution: z.string().trim().max(120).nullable(),
    course: z.string().trim().max(120).nullable(),
    currentTerm: z.number().int().min(1).max(20).nullable(),
    timezone: timezoneSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { error: "Nada para atualizar." });
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;

export const sessionIdParamsSchema = z.object({ id: z.uuid({ error: "Sessão inválida." }) });

/**
 * Confirmação para excluir a conta (LGPD):
 * - se a conta tem senha (`hasPassword: true`), exige a `password` atual;
 * - se entrou só por magic link ou Google (`hasPassword: false`), exige o `email` da conta.
 */
export const deleteMeBodySchema = z
  .object({
    /** Conta com senha: confirma digitando a senha. */
    password: z.string().min(1).max(128).optional(),
    /** Conta sem senha: o token do link de exclusão enviado por e-mail. */
    token: tokenSchema.optional(),
  })
  .refine((b) => Boolean(b.password || b.token), {
    error: "Confirme com sua senha ou pelo link enviado ao seu e-mail.",
  });
export type DeleteMeBody = z.infer<typeof deleteMeBodySchema>;

// ---- Respostas ----

export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  fullName: z.string(),
  institution: z.string().nullable(),
  course: z.string().nullable(),
  currentTerm: z.number().int().nullable(),
  timezone: z.string(),
  onboarded: z.boolean(),
  hasPassword: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Resposta de ações que enviam e-mail: sempre igual, exista ou não a conta. */
export const acceptedResponseSchema = z.object({ status: z.literal("accepted") });
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;

export const sessionSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  current: z.boolean(),
});
export const sessionsResponseSchema = z.object({ sessions: z.array(sessionSchema) });
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;

// ---- Segundo fator (TOTP) ----

/** Login com segundo fator ligado: a sessão só abre depois do código (POST /v1/auth/mfa/verify). */
export const mfaRequiredResponseSchema = z.object({ mfaRequired: z.literal(true) });
export type MfaRequiredResponse = z.infer<typeof mfaRequiredResponseSchema>;

/** Resposta das rotas que abrem sessão: o perfil, ou o pedido do segundo fator. */
export const loginResponseSchema = z.union([meResponseSchema, mfaRequiredResponseSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Código do app autenticador (6 dígitos) ou de recuperação (XXXX-XXXX). */
export const mfaCodeSchema = z
  .string()
  .trim()
  .min(6, { error: "Digite o código de 6 dígitos." })
  .max(20, { error: "Código inválido." });
export const mfaCodeBodySchema = z.object({ code: mfaCodeSchema });
export type MfaCodeBody = z.infer<typeof mfaCodeBodySchema>;

/** Conta sem senha começa a ativação com o token do link enviado ao e-mail. */
export const mfaSetupBodySchema = z.object({ token: tokenSchema.optional() }).default({});
export type MfaSetupBody = z.infer<typeof mfaSetupBodySchema>;

export const mfaEnableBodySchema = z.object({
  code: mfaCodeSchema,
  /** Conta com senha confirma a senha para ligar o segundo fator. */
  password: z.string().min(1).max(128).optional(),
});
export type MfaEnableBody = z.infer<typeof mfaEnableBodySchema>;

export const mfaStatusResponseSchema = z.object({
  /** false: o servidor não tem a chave de cifra configurada. */
  available: z.boolean(),
  enabled: z.boolean(),
  recoveryCodesLeft: z.number().int().min(0),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const mfaSetupResponseSchema = z.object({
  /** Segredo em base32, para digitar no app se não der para ler o QR Code. */
  secret: z.string(),
  otpauthUrl: z.string(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const mfaRecoveryCodesResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });
export type MfaRecoveryCodesResponse = z.infer<typeof mfaRecoveryCodesResponseSchema>;

// ---- Sugestões e problemas ----

export const feedbackKindSchema = z.enum(["sugestao", "problema", "outro"]);
export const feedbackBodySchema = z.object({
  kind: feedbackKindSchema,
  message: z
    .string()
    .trim()
    .min(10, { error: "Conte um pouco mais (pelo menos 10 caracteres)." })
    .max(2000, { error: "Use no máximo 2000 caracteres." }),
  /** Tela em que a pessoa estava (ajuda a achar o problema). */
  page: z.string().max(200).optional(),
});
export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

/** Códigos de erro estáveis das rotas de autenticação (campo `code` do problem+json). */
export const AuthErrorCode = {
  invalidCredentials: "INVALID_CREDENTIALS",
  passwordBreached: "PASSWORD_BREACHED",
  invalidToken: "INVALID_TOKEN",
  accountDisabled: "ACCOUNT_DISABLED",
  emailNotVerified: "EMAIL_NOT_VERIFIED",
  googleNotConfigured: "GOOGLE_NOT_CONFIGURED",
  mfaInvalidCode: "MFA_INVALID_CODE",
  mfaChallengeExpired: "MFA_CHALLENGE_EXPIRED",
  mfaUnavailable: "MFA_UNAVAILABLE",
  mfaConfirmationRequired: "MFA_CONFIRMATION_REQUIRED",
  mfaLocked: "MFA_LOCKED",
} as const;
