import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../database/db.service";

export type TokenPurpose =
  "verify_email" | "reset_password" | "magic_link" | "delete_account" | "mfa_enable";

export interface UserCredentials {
  userId: string;
  passwordHash: string | null;
  status: "active" | "disabled" | "pending_deletion";
  emailVerified: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  emailVerified: boolean;
}

/**
 * Chamadas às funções SECURITY DEFINER de autenticação (migration 0003_auth).
 * São as únicas consultas da API que rodam sem app.user_id.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly db: DbService) {}

  async findUserByEmail(email: string): Promise<UserCredentials | undefined> {
    const { rows } = await this.db.unscoped.execute<{
      user_id: string;
      password_hash: string | null;
      status: UserCredentials["status"];
      email_verified: boolean;
    }>(sql`select * from app.auth_find_user_by_email(${email})`);
    const row = rows[0];
    return (
      row && {
        userId: row.user_id,
        passwordHash: row.password_hash,
        status: row.status,
        emailVerified: row.email_verified,
      }
    );
  }

  async resolveSession(tokenHash: Buffer): Promise<ResolvedSession | undefined> {
    const { rows } = await this.db.unscoped.execute<{
      session_id: string;
      user_id: string;
      created_at: string | Date;
      last_seen_at: string | Date;
      expires_at: string | Date;
      email_verified: boolean;
    }>(sql`select * from app.auth_resolve_session(${tokenHash})`);
    const row = rows[0];
    return (
      row && {
        sessionId: row.session_id,
        userId: row.user_id,
        createdAt: new Date(row.created_at),
        lastSeenAt: new Date(row.last_seen_at),
        expiresAt: new Date(row.expires_at),
        emailVerified: row.email_verified,
      }
    );
  }

  async issueToken(params: {
    userId: string | null;
    email: string;
    purpose: TokenPurpose;
    tokenHash: Buffer;
    ttlSeconds: number;
  }): Promise<void> {
    await this.db.unscoped.execute(
      sql`select app.auth_issue_token(${params.userId}::uuid, ${params.email}, ${params.purpose}::app.token_purpose, ${params.tokenHash}, ${params.ttlSeconds})`,
    );
  }

  /** Marca o link como usado e devolve a conta (ou só o e-mail). Undefined = inválido/usado/expirado. */
  async consumeToken(
    tokenHash: Buffer,
    purpose: TokenPurpose,
  ): Promise<{ userId: string | null; email: string } | undefined> {
    const { rows } = await this.db.unscoped.execute<{ user_id: string | null; email: string }>(
      sql`select * from app.auth_consume_token(${tokenHash}, ${purpose}::app.token_purpose)`,
    );
    const row = rows[0];
    return row && { userId: row.user_id, email: row.email };
  }

  /** Cadastro pendente: guarda nome e hash da senha no link de confirmação (só o último vale). */
  async issueRegistration(params: {
    email: string;
    fullName: string;
    passwordHash: string;
    tokenHash: Buffer;
    ttlSeconds: number;
  }): Promise<void> {
    await this.db.unscoped.execute(
      sql`select app.auth_issue_registration(${params.email}, ${params.fullName}, ${params.passwordHash}, ${params.tokenHash}, ${params.ttlSeconds})`,
    );
  }

  /** Consome o link de cadastro (uma vez só). Undefined = inválido, usado ou expirado. */
  async consumeRegistration(
    tokenHash: Buffer,
  ): Promise<{ email: string; fullName: string; passwordHash: string } | undefined> {
    const { rows } = await this.db.unscoped.execute<{
      email: string;
      full_name: string | null;
      password_hash: string | null;
    }>(sql`select * from app.auth_consume_registration(${tokenHash})`);
    const row = rows[0];
    if (!row?.full_name || !row.password_hash) return undefined;
    return { email: row.email, fullName: row.full_name, passwordHash: row.password_hash };
  }

  async findAccount(provider: "google", providerAccountId: string): Promise<string | undefined> {
    const { rows } = await this.db.unscoped.execute<{ user_id: string | null }>(
      sql`select app.auth_find_account(${provider}, ${providerAccountId}) as user_id`,
    );
    return rows[0]?.user_id ?? undefined;
  }
}
