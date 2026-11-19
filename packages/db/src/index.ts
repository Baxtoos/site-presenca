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

/**
 * Códigos do Postgres de conexão encerrada pelo servidor: 57P01 (o Neon reiniciou ou suspendeu
 * o banco: "terminating connection due to administrator command"), 57P02, 57P03 e a família 08.
 */
const CONNECTION_LOST_CODES = new Set(["57P01", "57P02", "57P03", "08000", "08003", "08006"]);

/**
 * A conexão caiu no meio (servidor reiniciado, rede)? A transação em andamento foi desfeita pelo
 * banco, então dá para repetir. O Drizzle embrulha o erro do pg em `cause`.
 */
export function isConnectionLost(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const err = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof err.code === "string" && CONNECTION_LOST_CODES.has(err.code)) return true;
    if (err.code === "ECONNRESET" || err.code === "EPIPE") return true;
    if (
      typeof err.message === "string" &&
      /Connection terminated|terminating connection|server closed the connection/i.test(err.message)
    ) {
      return true;
    }
    e = err.cause;
  }
  return false;
}

export interface CreateDbOptions {
  connectionString: string;
  /** Nome que aparece em pg_stat_activity (ex.: "presenca-api"). */
  applicationName: string;
  maxConnections?: number;
  /** Tempo máximo de uma consulta. Padrão: 5 s. */
  statementTimeoutMs?: number;
}

/**
 * Deixa explícita a verificação completa do certificado. O pg já trata `sslmode=require` (o que o
 * Neon mostra) como `verify-full`, mas avisa que no pg 9 isso vira a semântica fraca do libpq.
 * Pedir `verify-full` mantém a segurança de hoje e cala o aviso.
 */
export function withVerifiedTls(connectionString: string): string {
  return connectionString.replace(
    /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/,
    "$1verify-full",
  );
}

export function createDb(options: CreateDbOptions): DbHandle {
  const config: PoolConfig = {
    connectionString: withVerifiedTls(options.connectionString),
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 5_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
  const pool = new Pool(config);
  // Conexão parada que o servidor encerra (o Neon dorme ou reinicia) emite "error" no pool. Sem
  // este ouvinte, o Node derrubaria o processo; com ele, o pool descarta a conexão e abre outra.
  pool.on("error", () => undefined);
  // Conexão EM USO que cai também emite "error" (além de rejeitar a consulta, que é tratada por
  // quem chamou). Sem ouvinte, isso também derrubaria o processo.
  pool.on("connect", (client) => {
    client.on("error", () => undefined);
  });
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
  // Depois que `fn` termina, o próximo passo é o COMMIT: se a conexão cair aí, não dá para saber
  // se ele foi gravado, então não repete (repetir poderia gravar duas vezes).
  let committing = false;
  const run = () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      if (ctx.requestId) {
        await tx.execute(sql`select set_config('app.request_id', ${ctx.requestId}, true)`);
      }
      const result = await fn(tx);
      committing = true;
      return result;
    });
  try {
    return await run();
  } catch (error) {
    // Conexão encerrada pelo servidor no meio: a transação foi desfeita, então repete uma vez
    // numa conexão nova (o aluno não vê o erro). Qualquer outro erro sobe como está.
    if (committing || !isConnectionLost(error)) throw error;
    return run();
  }
}
