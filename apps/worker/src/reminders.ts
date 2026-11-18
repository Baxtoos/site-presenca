import type { CheckinPayload } from "@presenca/contracts";
import type { Pool } from "pg";
import { addDaysIso, localParts, toMinutes } from "./time";

/** Depois do horário escolhido, o lembrete ainda sai por 3 h (worker parado, deploy...). */
const WINDOW_MINUTES = 180;

interface Candidate {
  userId: string;
  mode: "daily" | "weekly";
  time: string;
  weekday: number;
  timezone: string;
  emailOk: boolean;
  pushEnabled: boolean;
}

/**
 * Aulas da grade sem registro nos dias informados (feriados e matérias arquivadas não contam).
 * O worker só enxerga quais aulas têm registro, nunca o conteúdo deles.
 */
export async function unmarkedClasses(pool: Pool, userId: string, days: string[]): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n
       from app.subject_schedules sc
       join app.subjects s on s.id = sc.subject_id and s.archived_at is null
       join app.semesters se on se.id = s.semester_id and se.status = 'active'
      cross join unnest($2::date[]) as d(day)
      where sc.user_id = $1
        and sc.weekday = extract(isodow from d.day)
        and d.day between se.starts_on and se.ends_on
        and (sc.valid_from is null or sc.valid_from <= d.day)
        and (sc.valid_until is null or sc.valid_until >= d.day)
        and not exists (
          select 1 from app.calendar_exceptions e
           where e.semester_id = se.id and e.kind <> 'exam_week'
             and (e.subject_id is null or e.subject_id = s.id)
             and d.day between e.starts_on and e.ends_on)
        and not exists (
          select 1 from app.attendance_logs l
           where l.user_id = $1 and l.subject_id = s.id
             and l.schedule_id = sc.id and l.class_date = d.day)`,
    [userId, days],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Gera os lembretes de chamada que venceram ("Já marcou as aulas de hoje?"). Um por aluno por dia
 * (dedupe_key), mesmo com vários workers ou ciclos seguidos. Sem aula pendente, grava um marcador
 * pulado: o dia fica resolvido e não é recontado a cada ciclo.
 */
export async function enqueueReminders(pool: Pool, now: Date): Promise<number> {
  const { rows: candidates } = await pool.query<Candidate>(
    `select p.user_id as "userId", p.checkin_reminder as mode,
            to_char(p.checkin_time, 'HH24:MI') as time, p.checkin_weekday as weekday,
            u.timezone, p.push_enabled as "pushEnabled",
            (p.email_enabled and u.email_verified_at is not null) as "emailOk"
       from app.notification_preferences p
       join app.users u on u.id = p.user_id
      where p.checkin_reminder <> 'off' and u.status = 'active'`,
  );

  let created = 0;
  for (const c of candidates) {
    const local = localParts(now, c.timezone);
    const since = local.minutes - toMinutes(c.time);
    if (since < 0 || since >= WINDOW_MINUTES) continue;
    if (c.mode === "weekly" && local.weekday !== c.weekday) continue;

    const dedupeKey = `checkin:${c.userId}:${local.date}`;
    const { rowCount: done } = await pool.query(
      `select 1 from app.notification_logs where dedupe_key = $1 and channel = 'in_app'`,
      [dedupeKey],
    );
    if (done) continue;

    const days =
      c.mode === "daily"
        ? [local.date]
        : Array.from({ length: 7 }, (_, i) => addDaysIso(local.date, -i));
    const count = await unmarkedClasses(pool, c.userId, days);
    const base = { userId: c.userId, dedupeKey };

    if (count === 0) {
      await insertLog(pool, {
        ...base,
        channel: "in_app",
        status: "skipped",
        payload: {},
        error: "nenhuma aula pendente",
      });
      continue;
    }
    const payload: CheckinPayload = { count, scope: c.mode === "daily" ? "today" : "week" };
    await insertLog(pool, { ...base, channel: "in_app", status: "sent", payload });
    // Lembrete vale pelo celular; sem push, vai por e-mail (se a pessoa recebe e-mails).
    if (c.pushEnabled) {
      await insertLog(pool, { ...base, channel: "push", status: "pending", payload });
    } else if (c.emailOk) {
      await insertLog(pool, { ...base, channel: "email", status: "pending", payload });
    }
    created++;
  }
  return created;
}

async function insertLog(
  pool: Pool,
  log: {
    userId: string;
    dedupeKey: string;
    channel: "in_app" | "push" | "email";
    status: "sent" | "pending" | "skipped";
    payload: unknown;
    error?: string;
  },
): Promise<void> {
  await pool.query(
    `insert into app.notification_logs
       (user_id, kind, channel, dedupe_key, status, payload, last_error, sent_at)
     values ($1, 'checkin_reminder', $2, $3, $4, $5, $6, case when $7 then now() end)
     on conflict (dedupe_key, channel) do nothing`,
    [
      log.userId,
      log.channel,
      log.dedupeKey,
      log.status,
      JSON.stringify(log.payload),
      log.error ?? null,
      log.status === "sent",
    ],
  );
}
