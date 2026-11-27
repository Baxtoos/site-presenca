import type { TaskDuePayload } from "@presenca/contracts";
import type { Pool, PoolClient } from "pg";
import { formatLocalDateTimeBR } from "./time";

const MAX_REMIND_MINUTES = 2880;

/**
 * Chave do aviso: `task_due:{tarefa}:{prazo em minutos desde 1970}:{antecedência}`. Inclui o prazo:
 * se o aluno (ou, depois, o professor no Moodle) mudar a data da entrega, o aviso novo tem outra
 * chave e sai de novo; com a mesma tarefa e o mesmo prazo, nunca sai duas vezes.
 */
export function taskDueKey(taskId: string, dueAt: Date, remindBeforeMinutes: number): string {
  return `task_due:${taskId}:${Math.floor(dueAt.getTime() / 60_000)}:${remindBeforeMinutes}`;
}

interface Candidate {
  id: string;
  userId: string;
  title: string;
  dueAt: Date;
  remind: number;
  subjectName: string | null;
  timezone: string;
  pushOn: boolean;
  emailOk: boolean;
}

export async function enqueueTaskReminders(pool: Pool, now: Date): Promise<number> {
  const { rows } = await pool.query<Candidate>(
    `select t.id, t.user_id as "userId", t.title, t.due_at as "dueAt",
            t.remind_before_minutes as remind, s.name as "subjectName", u.timezone,
            coalesce(p.push_enabled, false) as "pushOn",
            (coalesce(p.email_enabled, true) and u.email_verified_at is not null) as "emailOk"
       from app.tasks t
       join app.users u on u.id = t.user_id and u.status = 'active'
       left join app.subjects s on s.id = t.subject_id
       left join app.notification_preferences p on p.user_id = t.user_id
      where t.status = 'pending'
        and t.remind_before_minutes is not null
        and t.due_at > $1
        and t.due_at <= $1 + make_interval(mins => $2)
        and t.due_at - make_interval(mins => t.remind_before_minutes) <= $1
        and not exists (
          select 1 from app.notification_logs n
           where n.task_id = t.id and n.channel = 'in_app'
             and n.dedupe_key = 'task_due:' || t.id || ':'
                 || floor(extract(epoch from t.due_at) / 60)::bigint || ':' || t.remind_before_minutes
        )
      order by t.due_at
      limit 500`,
    [now, MAX_REMIND_MINUTES],
  );

  let created = 0;
  for (const t of rows) {
    const dedupeKey = taskDueKey(t.id, t.dueAt, t.remind);
    const payload: TaskDuePayload = {
      taskId: t.id,
      title: t.title,
      subjectName: t.subjectName,
      dueAt: t.dueAt.toISOString(),
      dueLabel: formatLocalDateTimeBR(t.dueAt, t.timezone),
      remindBeforeMinutes: t.remind,
    };
    const client = await pool.connect();
    try {
      await client.query("begin");
      const inserted = await insertLog(client, t, dedupeKey, "in_app", "sent", payload);
      if (inserted) {
        if (t.pushOn) await insertLog(client, t, dedupeKey, "push", "pending", payload);
        if (t.emailOk) await insertLog(client, t, dedupeKey, "email", "pending", payload);
        created++;
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return created;
}

async function insertLog(
  pool: Pick<PoolClient, "query">,
  task: Candidate,
  dedupeKey: string,
  channel: "in_app" | "push" | "email",
  status: "sent" | "pending",
  payload: TaskDuePayload,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `insert into app.notification_logs
       (user_id, task_id, kind, channel, dedupe_key, status, payload, sent_at)
     values ($1, $2, 'task_due', $3, $4, $5, $6, case when $7 then now() end)
     on conflict (dedupe_key, channel) do nothing`,
    [task.userId, task.id, channel, dedupeKey, status, JSON.stringify(payload), status === "sent"],
  );
  return (rowCount ?? 0) > 0;
}

export async function taskStillDue(
  pool: Pool,
  taskId: string | null,
  dedupeKey: string,
  now: Date,
): Promise<string | null> {
  if (!taskId) return "tarefa apagada";
  const { rows } = await pool.query<{ status: string; dueAt: Date; remind: number | null }>(
    `select status, due_at as "dueAt", remind_before_minutes as remind
       from app.tasks where id = $1`,
    [taskId],
  );
  const task = rows[0];
  if (!task) return "tarefa apagada";
  if (task.status !== "pending") return "tarefa já marcada pelo aluno";
  if (task.remind === null) return "aviso desligado pelo aluno";
  if (taskDueKey(taskId, task.dueAt, task.remind) !== dedupeKey)
    return "prazo ou antecedência mudaram";
  if (task.dueAt.getTime() <= now.getTime()) return "o prazo já passou";
  return null;
}
