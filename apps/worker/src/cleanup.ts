import type { Pool } from "pg";

export interface CleanupStats {
  idempotencyKeys: number;
  sessions: number;
  authTokens: number;
}

export async function cleanupExpired(pool: Pool): Promise<CleanupStats> {
  const keys = await pool.query(
    `delete from app.idempotency_keys where created_at < now() - interval '24 hours'`,
  );
  const sessions = await pool.query(
    `delete from app.sessions
      where expires_at < now() - interval '7 days'
         or revoked_at < now() - interval '7 days'`,
  );
  const tokens = await pool.query(
    `delete from app.auth_tokens
      where expires_at < now() - interval '1 day' or used_at < now() - interval '1 day'`,
  );
  return {
    idempotencyKeys: keys.rowCount ?? 0,
    sessions: sessions.rowCount ?? 0,
    authTokens: tokens.rowCount ?? 0,
  };
}
