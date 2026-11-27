import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  inet,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, bytea, createdAt, pk, updatedAt } from "./_shared";
import { tokenPurpose, userStatus } from "./enums";

export const users = app.table(
  "users",
  {
    id: pk(),
    email: text().notNull(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    passwordHash: text(),
    fullName: text().notNull(),
    institution: text(),
    course: text(),
    currentTerm: smallint(),
    timezone: text().notNull().default("America/Sao_Paulo"),
    status: userStatus().notNull().default("active"),
    onboardedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("users_email_key").on(t.email),
    check("users_email_lower_chk", sql`${t.email} = lower(${t.email})`),
    check("users_email_format_chk", sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("users_full_name_chk", sql`char_length(${t.fullName}) between 1 and 120`),
    check("users_current_term_chk", sql`${t.currentTerm} between 1 and 20`),
    check("users_timezone_chk", sql`char_length(${t.timezone}) between 1 and 64`),
  ],
);

export const authAccounts = app.table(
  "auth_accounts",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    email: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("auth_accounts_provider_key").on(t.provider, t.providerAccountId),
    index("auth_accounts_user_idx").on(t.userId),
    check("auth_accounts_provider_chk", sql`${t.provider} in ('google')`),
  ],
);

export const sessions = app.table(
  "sessions",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 do token do cookie. O token em si nunca é guardado. */
    tokenHash: bytea().notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ip: inet(),
    userAgent: text(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
    check("sessions_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
    check("sessions_token_hash_len_chk", sql`octet_length(${t.tokenHash}) = 32`),
  ],
);

export const authTokens = app.table(
  "auth_tokens",
  {
    id: pk(),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    email: text().notNull(),
    purpose: tokenPurpose().notNull(),
    tokenHash: bytea().notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    pendingFullName: text(),
    pendingPasswordHash: text(),
  },
  (t) => [
    unique("auth_tokens_token_hash_key").on(t.tokenHash),
    index("auth_tokens_user_idx").on(t.userId),
    index("auth_tokens_expires_idx").on(t.expiresAt),
    check("auth_tokens_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
    check("auth_tokens_token_hash_len_chk", sql`octet_length(${t.tokenHash}) = 32`),
    check(
      "auth_tokens_user_required_chk",
      sql`${t.userId} is not null or ${t.purpose}::text in ('magic_link', 'register')`,
    ),
  ],
);

/**
 * Segundo fator (app autenticador, TOTP). Uma linha por conta; sem linha, sem segundo fator.
 * O segredo fica cifrado (AES-256-GCM) com a chave MFA_ENCRYPTION_KEY, que só a API conhece.
 */
export const userMfa = app.table(
  "user_mfa",
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    secretCiphertext: bytea().notNull(),
    enabledAt: timestamp({ withTimezone: true }),
    lastUsedStep: bigint({ mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("user_mfa_secret_len_chk", sql`octet_length(${t.secretCiphertext}) between 40 and 200`),
  ],
);

/** Códigos de recuperação do segundo fator (uso único). Só o hash SHA-256 é guardado. */
export const mfaRecoveryCodes = app.table(
  "mfa_recovery_codes",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: bytea().notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("mfa_recovery_codes_user_code_key").on(t.userId, t.codeHash),
    check("mfa_recovery_codes_hash_len_chk", sql`octet_length(${t.codeHash}) = 32`),
  ],
);
