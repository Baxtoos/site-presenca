import type { Pool } from "pg";
import { MAX_ATTEMPTS } from "./time";

export interface OutboxItem {
  id: string;
  userId: string;
  subjectId: string | null;
  taskId: string | null;
  kind: "threshold" | "checkin_reminder" | "system" | "task_due";
  channel: "email" | "push";
  dedupeKey: string;
  attempts: number;
  payload: unknown;
}

export const LEASE = "5 minutes";

export async function claim(pool: Pool, limit: number): Promise<OutboxItem[]> {
  const { rows } = await pool.query<OutboxItem>(
    `with due as (
       select id from app.notification_logs
        where channel in ('email', 'push')
          and status in ('pending', 'failed', 'sending')
          and scheduled_for <= now()
          and attempts < $2
        order by scheduled_for
        limit $1
        for update skip locked
     )
     update app.notification_logs n
        set status = 'sending',
            attempts = n.attempts + 1,
            scheduled_for = now() + interval '${LEASE}'
       from due
      where n.id = due.id
  returning n.id, n.user_id as "userId", n.subject_id as "subjectId", n.task_id as "taskId",
            n.kind, n.channel,
            n.dedupe_key as "dedupeKey", n.attempts, n.payload`,
    [limit, MAX_ATTEMPTS],
  );
  return rows;
}

export async function markSent(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `update app.notification_logs set status = 'sent', sent_at = now(), last_error = null
      where id = $1`,
    [id],
  );
}

export async function markSkipped(pool: Pool, id: string, reason: string): Promise<void> {
  await pool.query(
    `update app.notification_logs set status = 'skipped', last_error = $2 where id = $1`,
    [id, reason],
  );
}

export async function markFailed(
  pool: Pool,
  id: string,
  error: string,
  retryInMs: number,
): Promise<void> {
  await pool.query(
    `update app.notification_logs
        set status = 'failed', last_error = left($2, 500),
            scheduled_for = now() + ($3::int * interval '1 millisecond')
      where id = $1`,
    [id, error, retryInMs],
  );
}

export async function postpone(pool: Pool, id: string, until: Date): Promise<void> {
  await pool.query(
    `update app.notification_logs
        set status = 'pending', attempts = greatest(attempts - 1, 0), scheduled_for = $2
      where id = $1`,
    [id, until],
  );
}

export async function closeExhausted(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `update app.notification_logs
        set status = 'failed', last_error = coalesce(last_error, 'tentativas esgotadas')
      where status = 'sending' and scheduled_for <= now() and attempts >= $1`,
    [MAX_ATTEMPTS],
  );
  return rowCount ?? 0;
}
