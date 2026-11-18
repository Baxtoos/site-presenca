import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export { newId } from "./id";
export { schema };
export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DbHandle {
  db: Db;
  pool: Pool;
  /** Testa a conexão com um `select 1`; retorna a latência em ms. */
  ping(): Promise<number>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  connectionString: string;
  /** Nome que aparece em pg_stat_activity (ex.: "presenca-api"). */
  applicationName: string;
  maxConnections?: number;
  /** Tempo máximo de uma consulta. Padrão: 5 s. */
  statementTimeoutMs?: number;
}

export function createDb(options: CreateDbOptions): DbHandle {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 5_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
  const pool = new Pool(config);
  const db = drizzle(pool, { schema, casing: "snake_case" });

  return {
    db,
    pool,
    async ping() {
      const started = performance.now();
      await pool.query("select 1");
      return Math.round(performance.now() - started);
    },
    close: () => pool.end(),
  };
}

export interface TxContext {
  userId: string;
  /** Vai para a trilha de auditoria (attendance_log_events.request_id). */
  requestId?: string;
}

/**
 * Abre uma transação já identificada com o usuário.
 * As políticas de RLS leem `app.user_id`; sem ele, nenhuma linha é visível (falha fechada).
 * O `true` em set_config faz o valor valer só dentro desta transação.
 */
export async function withUser<T>(db: Db, ctx: TxContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(ctx.userId)) throw new TypeError("withUser: userId precisa ser um UUID");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
    if (ctx.requestId) {
      await tx.execute(sql`select set_config('app.request_id', ${ctx.requestId}, true)`);
    }
    return fn(tx);
  });
}
