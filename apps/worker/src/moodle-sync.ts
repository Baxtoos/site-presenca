import type { Db } from "@presenca/db";
import {
  applyMoodleGrades,
  describeSyncError,
  fetchMoodleDeadlines,
  fetchMoodleGrades,
  mappedCourses,
  reconcileDeadlines,
  type SafeFetchOptions,
} from "@presenca/integrations";
import type { Pool } from "pg";

/** De quanto em quanto tempo cada conexão é sincronizada (mais uma folga aleatória). */
const SYNC_EVERY_MIN = 45;
const JITTER_MIN = 10;
/** Depois de uma falha, espera mais antes de tentar de novo (Moodle fora do ar, link vencido). */
const RETRY_AFTER_FAIL_MIN = 90;
/** Reserva: se o worker morrer no meio, a conexão volta para a fila depois disso. */
const LEASE_MIN = 10;
/** Conexões por ciclo (cada uma faz poucas requisições ao Moodle, com tempo limite de 8 s). */
const BATCH = 10;

export interface MoodleSyncDeps {
  pool: Pool;
  db: Db;
  key: Buffer;
  now: Date;
  fetchOptions?: SafeFetchOptions;
  log?: (level: "info" | "warn", msg: string, extra?: Record<string, unknown>) => void;
}

interface Claimed {
  id: string;
  userId: string;
  icsUrlEnc: string;
  baseUrl: string | null;
  wstokenEnc: string | null;
  timezone: string;
}

const minutes = (now: Date, n: number) => new Date(now.getTime() + n * 60_000);

/**
 * Sincroniza as conexões com o Moodle que venceram. Reserva com FOR UPDATE SKIP LOCKED (dois
 * workers nunca pegam a mesma), busca fora da transação e grava cada aluno numa transação própria.
 * Falha de uma conexão fica registrada nela (last_sync_error) e não derruba o ciclo.
 */
export async function syncMoodleConnections(deps: MoodleSyncDeps): Promise<number> {
  const { pool, now } = deps;
  const { rows } = await pool.query<Claimed>(
    `update app.moodle_connections c
        set next_sync_at = $2
       from app.users u
      where c.id in (
              select id from app.moodle_connections
               where sync_enabled and next_sync_at <= $1
               order by next_sync_at
               limit $3
               for update skip locked
            )
        and u.id = c.user_id and u.status = 'active'
      returning c.id, c.user_id as "userId", c.ics_url_enc as "icsUrlEnc",
                c.base_url as "baseUrl", c.wstoken_enc as "wstokenEnc", u.timezone`,
    [now, minutes(now, LEASE_MIN), BATCH],
  );

  for (const conn of rows) {
    let error: string | null = null;
    let next = minutes(now, SYNC_EVERY_MIN + Math.random() * JITTER_MIN);
    try {
      const { deadlines, warning } = await fetchMoodleDeadlines(
        conn,
        deps.key,
        now,
        deps.fetchOptions,
      );
      const result = await deps.db.transaction((tx) =>
        reconcileDeadlines(tx, { userId: conn.userId, deadlines, now }),
      );
      error = warning;
      if (result.created + result.updated + result.completed > 0) {
        deps.log?.("info", "moodle sincronizado", { connection: conn.id, ...result });
      }
      // Notas (só com wstoken): turmas ligadas a matérias → avaliações ligadas a itens do Moodle.
      if (conn.wstokenEnc && conn.baseUrl) {
        try {
          const courses = await deps.db.transaction((tx) => mappedCourses(tx, conn.userId));
          const grades = await fetchMoodleGrades(
            conn,
            deps.key,
            [...courses.keys()],
            deps.fetchOptions,
          );
          const applied = await deps.db.transaction((tx) =>
            applyMoodleGrades(tx, { userId: conn.userId, grades, courses }),
          );
          if (applied.updated > 0) {
            deps.log?.("info", "notas do moodle importadas", { connection: conn.id, ...applied });
          }
        } catch (e) {
          error ??= `Parcial (notas): ${describeSyncError(e)}`;
          deps.log?.("warn", "notas do moodle falharam", { connection: conn.id, error });
        }
      }
    } catch (e) {
      error = describeSyncError(e);
      next = minutes(now, RETRY_AFTER_FAIL_MIN);
      deps.log?.("warn", "sincronização do moodle falhou", { connection: conn.id, error });
    }
    await pool.query(
      `update app.moodle_connections
          set last_sync_at = $2, last_sync_error = $3, next_sync_at = $4
        where id = $1`,
      [conn.id, now, error, next],
    );
  }
  return rows.length;
}
