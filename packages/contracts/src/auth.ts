import { z } from "zod";

/** E-mail normalizado: sem espaços nas pontas e em minúsculas (o banco exige minúsculas). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Informe um e-mail válido." }).max(254));

/** Senha: 10 a 128 caracteres. O teto evita requisições caras de propósito (Argon2 é lento). */
export const passwordSchema = z
  .string()
  .min(10, { error: "A senha precisa ter pelo menos 10 caracteres." })
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

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
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

/** Códigos de erro estáveis das rotas de autenticação (campo `code` do problem+json). */
export const AuthErrorCode = {
  invalidCredentials: "INVALID_CREDENTIALS",
  emailTaken: "EMAIL_TAKEN",
  passwordBreached: "PASSWORD_BREACHED",
  invalidToken: "INVALID_TOKEN",
  accountDisabled: "ACCOUNT_DISABLED",
  emailNotVerified: "EMAIL_NOT_VERIFIED",
  googleNotConfigured: "GOOGLE_NOT_CONFIGURED",
} as const;
