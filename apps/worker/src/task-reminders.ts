import type { TaskDuePayload } from "@presenca/contracts";
import type { Pool } from "pg";
import { formatLocalDateTimeBR } from "./time";

/** A maior antecedência permitida (2 dias): limita a busca às tarefas que podem estar na janela. */
const MAX_REMIND_MINUTES = 2880;

/**
 * Chave do aviso. Inclui o prazo: se o aluno mudar a data da entrega, o aviso novo tem outra chave
 * e sai de novo; com a mesma tarefa e o mesmo prazo, nunca sai duas vezes.
 */
export function taskDueKey(taskId: string, dueAt: Date, remindBeforeMinutes: number): string {
  return `task_due:${taskId}:${Math.floor(dueAt.getTime() / 1000)}:${remindBeforeMinutes}`;
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

/**
 * Gera os avisos de entregas próximas. Uma tarefa pendente entra na janela quando faltam menos que
 * a antecedência escolhida para o prazo, e fica nela até o prazo: um worker pontual atrasado ainda
 * avisa; depois do prazo, nada sai (a tela mostra a tarefa como vencida). A chave única
 * (dedupe_key, channel) garante um aviso só, mesmo com vários workers ou ciclos seguidos.
 *
 * Diferente do lembrete de chamada, aqui saem os três canais ligados: sino, push e e-mail.
 */
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
        and t.due_at > $1
        and t.due_at <= $1 + make_interval(mins => $2)
        and t.due_at - make_interval(mins => t.remind_before_minutes) <= $1
        and not exists (
          select 1 from app.notification_logs n
           where n.task_id = t.id and n.channel = 'in_app'
             and n.dedupe_key = 'task_due:' || t.id || ':'
                 || floor(extract(epoch from t.due_at))::bigint || ':' || t.remind_before_minutes
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
    const inserted = await insertLog(pool, t, dedupeKey, "in_app", "sent", payload);
    if (!inserted) continue; // outro worker chegou antes
    if (t.pushOn) await insertLog(pool, t, dedupeKey, "push", "pending", payload);
    if (t.emailOk) await insertLog(pool, t, dedupeKey, "email", "pending", payload);
    created++;
  }
  return created;
}

async function insertLog(
  pool: Pool,
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

/**
 * Na hora de enviar push/e-mail, a tarefa ainda pede o aviso? Cobre o aluno que marcou, apagou ou
 * mudou o prazo depois de o aviso entrar na fila, e o envio adiado (horário de silêncio) que
 * passaria do prazo.
 */
export async function taskStillDue(
  pool: Pool,
  taskId: string | null,
  dedupeKey: string,
  now: Date,
): Promise<string | null> {
  if (!taskId) return "tarefa apagada";
  const { rows } = await pool.query<{ status: string; dueAt: Date; remind: number }>(
    `select status, due_at as "dueAt", remind_before_minutes as remind
       from app.tasks where id = $1`,
    [taskId],
  );
  const task = rows[0];
  if (!task) return "tarefa apagada";
  if (task.status !== "pending") return "tarefa já marcada pelo aluno";
  if (taskDueKey(taskId, task.dueAt, task.remind) !== dedupeKey)
    return "prazo ou antecedência mudaram";
  if (task.dueAt.getTime() <= now.getTime()) return "o prazo já passou";
  return null;
}
