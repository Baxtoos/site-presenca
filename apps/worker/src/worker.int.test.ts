import { randomUUID } from "node:crypto";
import { inTx, startTestDb, type TestDb } from "@presenca/db/testing";
import { CaptureMailer } from "@presenca/emails/transport";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupExpired } from "./cleanup";
import { didWork, runCycle } from "./cycle";
import { processOutbox } from "./delivery";
import { OutboxListener } from "./listener";
import type { PushMessage, PushOutcome, PushSender, PushTarget } from "./push";
import { enqueueReminders } from "./reminders";
import { MAX_ATTEMPTS } from "./time";

let db: TestDb;
let worker: Pool;
beforeAll(async () => {
  db = await startTestDb();
  worker = db.pools.app_worker; // o papel real do worker: valida as permissões da migration
});
afterAll(async () => {
  await db?.stop();
});

/** Push de mentira: cada endpoint pode responder ok, "gone" (410) ou erro. */
class FakePush implements PushSender {
  configured = true;
  readonly sent: { endpoint: string; message: PushMessage; urgent: boolean }[] = [];
  behavior = new Map<string, "ok" | "gone" | "error">();

  async send(target: PushTarget, message: PushMessage, urgent: boolean): Promise<PushOutcome> {
    const b = this.behavior.get(target.endpoint) ?? "ok";
    if (b === "gone") return { ok: false, gone: true, error: "push 410" };
    if (b === "error") return { ok: false, gone: false, error: "push 500: falhou" };
    this.sent.push({ endpoint: target.endpoint, message, urgent });
    return { ok: true };
  }
}

let mail: CaptureMailer;
let push: FakePush;
beforeEach(() => {
  mail = new CaptureMailer();
  push = new FakePush();
});

const deps = (now?: Date) => ({
  pool: worker,
  mailer: mail,
  push,
  appUrl: "https://app.exemplo",
  ...(now ? { now: () => now } : {}),
});

interface Student {
  userId: string;
  email: string;
  subjectId: string;
  scheduleId: string;
}

/** Aluno criado como a API faria (papel app_api, RLS ligado). */
async function student(
  opts: {
    verified?: boolean;
    timezone?: string;
    prefs?: Record<string, unknown>;
    pushEndpoints?: string[];
  } = {},
): Promise<Student> {
  const userId = randomUUID();
  const email = `worker.${userId.slice(0, 8)}@exemplo.com`;
  return inTx(db.pools.app_api, { userId }, async (c) => {
    await c.query(
      `insert into users (id, email, full_name, timezone, email_verified_at)
       values ($1, $2, 'Ana Souza', $3, $4)`,
      [
        userId,
        email,
        opts.timezone ?? "America/Sao_Paulo",
        opts.verified === false ? null : new Date(),
      ],
    );
    const semesterId = (
      await c.query<{ id: string }>(
        `insert into semesters (user_id, label, starts_on, ends_on, is_current)
         values ($1, '2026.2', '2026-08-03', '2026-12-18', true) returning id`,
        [userId],
      )
    ).rows[0]!.id;
    const subjectId = (
      await c.query<{ id: string }>(
        `insert into subjects (user_id, semester_id, name, counting_mode, manual_max_units)
         values ($1, $2, 'Física I', 'manual', 10) returning id`,
        [userId, semesterId],
      )
    ).rows[0]!.id;
    // Aula toda quarta.
    const scheduleId = (
      await c.query<{ id: string }>(
        `insert into subject_schedules (user_id, subject_id, weekday, starts_at, ends_at, units)
         values ($1, $2, 3, '19:00', '20:40', 2) returning id`,
        [userId, subjectId],
      )
    ).rows[0]!.id;
    const prefs = { email_enabled: true, push_enabled: false, ...opts.prefs };
    const cols = Object.keys(prefs);
    await c.query(
      `insert into notification_preferences (user_id, ${cols.join(", ")})
       values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})`,
      [userId, ...Object.values(prefs)],
    );
    for (const endpoint of opts.pushEndpoints ?? []) {
      await c.query(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'chave', 'segredo')`,
        [userId, endpoint],
      );
    }
    return { userId, email, subjectId, scheduleId };
  });
}

/** Alerta de 75% como a API grava (in_app entregue + e-mail/push pendentes). */
async function thresholdAlert(s: Student, channels: ("email" | "push")[] = ["email"]) {
  const dedupe = `threshold:${s.subjectId}:75:1`;
  const payload = {
    subjectName: "Física I",
    thresholdPct: 75,
    absentUnits: 8,
    maxUnits: 10,
    remainingUnits: 2,
    remainingClasses: 2,
  };
  const ids: Record<string, string> = {};
  await inTx(db.pools.app_api, { userId: s.userId }, async (c) => {
    for (const channel of channels) {
      ids[channel] = (
        await c.query<{ id: string }>(
          `insert into notification_logs
             (user_id, subject_id, kind, channel, threshold_pct, cycle, dedupe_key, status, payload)
           values ($1, $2, 'threshold', $3, 75, 1, $4, 'pending', $5) returning id`,
          [s.userId, s.subjectId, channel, dedupe, JSON.stringify(payload)],
        )
      ).rows[0]!.id;
    }
  });
  return ids;
}

const row = async (id: string) =>
  (
    await db.admin.query<{
      status: string;
      attempts: number;
      last_error: string | null;
      sent_at: Date | null;
      scheduled_for: Date;
    }>(
      "select status, attempts, last_error, sent_at, scheduled_for from app.notification_logs where id = $1",
      [id],
    )
  ).rows[0]!;

describe("entrega de e-mail", () => {
  it("envia com o texto do aviso, link do app e o id como chave de idempotência", async () => {
    const s = await student();
    const { email } = await thresholdAlert(s);
    const stats = await processOutbox(deps());
    expect(stats.sent).toBeGreaterThanOrEqual(1);
    const sent = mail.lastTo(s.email)!;
    expect(sent.subject).toBe("Física I: 75% do limite de faltas");
    expect(sent.text).toContain("Olá, Ana.");
    expect(sent.text).toContain("Você tem 8 de 10 faltas. Ainda pode faltar 2 aulas.");
    expect(sent.text).toContain(`https://app.exemplo/materias/${s.subjectId}`);
    expect(sent.idempotencyKey).toBe(email);
    expect(await row(email!)).toMatchObject({ status: "sent", attempts: 1, last_error: null });
    expect((await row(email!)).sent_at).not.toBeNull();
  });

  it("decide na hora do envio: e-mail desconfirmado ou desligado depois do alerta → pulado", async () => {
    const s = await student();
    const { email } = await thresholdAlert(s);
    await db.admin.query("update app.users set email_verified_at = null where id = $1", [s.userId]);
    await processOutbox(deps());
    expect(await row(email!)).toMatchObject({
      status: "skipped",
      last_error: "e-mail não confirmado",
    });
    expect(mail.lastTo(s.email)).toBeUndefined();
  });

  it("falha do provedor: fica como falha, com espera crescente, e tenta de novo depois", async () => {
    const s = await student();
    const { email } = await thresholdAlert(s);
    const broken = { send: async () => Promise.reject(new Error("SMTP fora do ar")) };
    await processOutbox({ ...deps(), mailer: broken });
    const failed = await row(email!);
    expect(failed).toMatchObject({ status: "failed", attempts: 1, last_error: "SMTP fora do ar" });
    expect(failed.scheduled_for.getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Ainda não venceu: nada acontece.
    await processOutbox(deps());
    expect(mail.lastTo(s.email)).toBeUndefined();
    // Venceu: entrega.
    await db.admin.query("update app.notification_logs set scheduled_for = now() where id = $1", [
      email,
    ]);
    await processOutbox(deps());
    expect(await row(email!)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("depois de esgotar as tentativas, desiste (não fica tentando para sempre)", async () => {
    const s = await student();
    const { email } = await thresholdAlert(s);
    await db.admin.query(
      "update app.notification_logs set attempts = $2, status = 'failed' where id = $1",
      [email, MAX_ATTEMPTS],
    );
    await processOutbox(deps());
    expect(await row(email!)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(mail.lastTo(s.email)).toBeUndefined();
  });

  it("reserva vencida (worker que morreu no meio) volta para a fila", async () => {
    const s = await student();
    const { email } = await thresholdAlert(s);
    await db.admin.query(
      "update app.notification_logs set status = 'sending', attempts = 1, scheduled_for = now() - interval '1 minute' where id = $1",
      [email],
    );
    await processOutbox(deps());
    expect(await row(email!)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("dois workers ao mesmo tempo: cada aviso sai uma vez só", async () => {
    const students = await Promise.all([1, 2, 3, 4, 5, 6].map(() => student()));
    for (const s of students) await thresholdAlert(s);
    await Promise.all([processOutbox(deps(), 2), processOutbox(deps(), 2)]);
    const delivered = mail.sent.filter((m) => students.some((s) => s.email === m.to));
    expect(delivered).toHaveLength(6);
    expect(new Set(delivered.map((m) => m.idempotencyKey)).size).toBe(6);
  });
});

describe("horário silencioso", () => {
  it("dentro da janela: adia para o fim dela sem gastar tentativa", async () => {
    const s = await student({ prefs: { quiet_start: "22:00", quiet_end: "07:00" } });
    const { email } = await thresholdAlert(s);
    // 23:30 em São Paulo.
    await processOutbox(deps(new Date("2026-11-19T02:30:00Z")));
    const r = await row(email!);
    expect(r).toMatchObject({ status: "pending", attempts: 0 });
    expect(r.scheduled_for.toISOString()).toBe("2026-11-19T10:00:00.000Z"); // 07:00 local
    expect(mail.lastTo(s.email)).toBeUndefined();
  });

  it("fora da janela: envia normalmente", async () => {
    const s = await student({ prefs: { quiet_start: "22:00", quiet_end: "07:00" } });
    const { email } = await thresholdAlert(s);
    await processOutbox(deps(new Date("2026-11-18T15:00:00Z"))); // 12:00 local
    expect(await row(email!)).toMatchObject({ status: "sent" });
  });
});

describe("entrega de push", () => {
  it("manda para todos os aparelhos, marcado como urgente; atualiza o último sucesso", async () => {
    const a = `https://push.exemplo/${randomUUID()}`;
    const b = `https://push.exemplo/${randomUUID()}`;
    const s = await student({ prefs: { push_enabled: true }, pushEndpoints: [a, b] });
    const { push: id } = await thresholdAlert(s, ["push"]);
    await processOutbox(deps());
    expect(push.sent.map((p) => p.endpoint).sort()).toEqual([a, b].sort());
    expect(push.sent[0]).toMatchObject({
      urgent: true,
      message: {
        title: "Física I: 75% do limite de faltas",
        url: `/materias/${s.subjectId}`,
        tag: `threshold:${s.subjectId}:75:1`,
      },
    });
    expect(await row(id!)).toMatchObject({ status: "sent" });
    const subs = await db.admin.query(
      "select last_success_at from app.push_subscriptions where user_id = $1",
      [s.userId],
    );
    expect(subs.rows.every((r) => r.last_success_at !== null)).toBe(true);
  });

  it("aparelho que cancelou (410) é apagado; se era o único, o envio fica pulado", async () => {
    const gone = `https://push.exemplo/${randomUUID()}`;
    const s = await student({ prefs: { push_enabled: true }, pushEndpoints: [gone] });
    push.behavior.set(gone, "gone");
    const { push: id } = await thresholdAlert(s, ["push"]);
    await processOutbox(deps());
    expect(await row(id!)).toMatchObject({
      status: "skipped",
      last_error: "aparelhos com push expirados",
    });
    const left = await db.admin.query("select 1 from app.push_subscriptions where endpoint = $1", [
      gone,
    ]);
    expect(left.rowCount).toBe(0);
  });

  it("um aparelho falhando e outro ok: conta como enviado", async () => {
    const ok = `https://push.exemplo/${randomUUID()}`;
    const bad = `https://push.exemplo/${randomUUID()}`;
    const s = await student({ prefs: { push_enabled: true }, pushEndpoints: [ok, bad] });
    push.behavior.set(bad, "error");
    const { push: id } = await thresholdAlert(s, ["push"]);
    await processOutbox(deps());
    expect(await row(id!)).toMatchObject({ status: "sent" });
    const failures = await db.admin.query(
      "select failure_count from app.push_subscriptions where endpoint = $1",
      [bad],
    );
    expect(failures.rows[0]).toEqual({ failure_count: 1 });
  });

  it("servidor sem chaves VAPID: pushes pulados, sem erro", async () => {
    const s = await student({
      prefs: { push_enabled: true },
      pushEndpoints: [`https://push.exemplo/${randomUUID()}`],
    });
    push.configured = false;
    const { push: id } = await thresholdAlert(s, ["push"]);
    await processOutbox(deps());
    expect(await row(id!)).toMatchObject({
      status: "skipped",
      last_error: "push não configurado no servidor",
    });
  });
});

describe("lembrete de chamada", () => {
  // Quarta, 18/11/2026, 21:10 em São Paulo.
  const WED_2110 = new Date("2026-11-19T00:10:00Z");

  const reminderLogs = async (userId: string) =>
    (
      await db.admin.query<{ channel: string; status: string; payload: unknown }>(
        `select channel, status, payload from app.notification_logs
          where user_id = $1 and kind = 'checkin_reminder' order by channel::text`,
        [userId],
      )
    ).rows;

  it("diário: aula de hoje sem registro → central + push; só uma vez por dia", async () => {
    const s = await student({
      prefs: { checkin_reminder: "daily", checkin_time: "21:00", push_enabled: true },
    });
    expect(await enqueueReminders(worker, WED_2110)).toBeGreaterThanOrEqual(1);
    const classes = [
      {
        subjectId: s.subjectId,
        scheduleId: s.scheduleId,
        classDate: "2026-11-18",
        name: "Física I",
      },
    ];
    expect(await reminderLogs(s.userId)).toEqual([
      { channel: "in_app", status: "sent", payload: { count: 1, scope: "today", classes } },
      { channel: "push", status: "pending", payload: { count: 1, scope: "today", classes } },
    ]);
    await enqueueReminders(worker, new Date(WED_2110.getTime() + 30 * 60_000));
    expect(await reminderLogs(s.userId)).toHaveLength(2);
  });

  it("sem push, o lembrete vai por e-mail; antes do horário, nada", async () => {
    const s = await student({ prefs: { checkin_reminder: "daily", checkin_time: "21:00" } });
    await enqueueReminders(worker, new Date("2026-11-18T23:50:00Z")); // 20:50 local
    expect(await reminderLogs(s.userId)).toEqual([]);
    await enqueueReminders(worker, WED_2110);
    expect((await reminderLogs(s.userId)).map((r) => r.channel)).toEqual(["email", "in_app"]);
  });

  it("aula já registrada: não lembra (e não reconta a cada ciclo)", async () => {
    const s = await student({ prefs: { checkin_reminder: "daily", checkin_time: "21:00" } });
    await inTx(db.pools.app_api, { userId: s.userId }, (c) =>
      c.query(
        `insert into attendance_logs (user_id, subject_id, schedule_id, class_date, status, units_scheduled, units_missed)
         values ($1, $2, $3, '2026-11-18', 'present', 2, 0)`,
        [s.userId, s.subjectId, s.scheduleId],
      ),
    );
    await enqueueReminders(worker, WED_2110);
    expect(await reminderLogs(s.userId)).toEqual([
      { channel: "in_app", status: "skipped", payload: {} },
    ]);
  });

  it("feriado: a aula não conta como pendente", async () => {
    const s = await student({ prefs: { checkin_reminder: "daily", checkin_time: "21:00" } });
    await db.admin.query(
      `insert into app.calendar_exceptions (user_id, semester_id, starts_on, ends_on, kind, label)
       select user_id, semester_id, '2026-11-18', '2026-11-18', 'holiday', 'Feriado' from app.subjects where id = $1`,
      [s.subjectId],
    );
    await enqueueReminders(worker, WED_2110);
    expect((await reminderLogs(s.userId))[0]).toMatchObject({ status: "skipped" });
  });

  it("semanal: só no dia escolhido, contando os últimos 7 dias", async () => {
    const s = await student({
      prefs: { checkin_reminder: "weekly", checkin_time: "21:00", checkin_weekday: 3 },
    });
    await enqueueReminders(worker, new Date("2026-11-18T00:10:00Z")); // terça 21:10: dia errado
    expect(await reminderLogs(s.userId)).toEqual([]);
    await enqueueReminders(worker, WED_2110);
    const [inApp] = (await reminderLogs(s.userId)).filter((r) => r.channel === "in_app");
    expect(inApp).toMatchObject({ status: "sent", payload: { count: 1, scope: "week" } });
  });

  it("respeita o fuso de cada aluno", async () => {
    // 21:10 de quarta em São Paulo é 09:10 de quinta em Tóquio: o aluno de Tóquio não recebe.
    const tokyo = await student({
      timezone: "Asia/Tokyo",
      prefs: { checkin_reminder: "daily", checkin_time: "21:00" },
    });
    await enqueueReminders(worker, WED_2110);
    expect(await reminderLogs(tokyo.userId)).toEqual([]);
  });

  it("o lembrete entregue usa o texto do contrato", async () => {
    const s = await student({ prefs: { checkin_reminder: "daily", checkin_time: "21:00" } });
    await enqueueReminders(worker, WED_2110);
    await processOutbox(deps(WED_2110));
    expect(mail.lastTo(s.email)?.subject).toBe("Já marcou as aulas de hoje?");
    expect(mail.lastTo(s.email)?.text).toContain("Física I: a aula de hoje está sem registro.");
  });

  it("push do lembrete leva as aulas para os botões Fui / Faltei", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/lembrete-${randomUUID()}`;
    const s = await student({
      prefs: { checkin_reminder: "daily", checkin_time: "21:00", push_enabled: true },
      pushEndpoints: [endpoint],
    });
    await enqueueReminders(worker, WED_2110);
    await processOutbox(deps(WED_2110));
    const sent = push.sent.find((p) => p.endpoint === endpoint);
    expect(sent?.message).toMatchObject({
      title: "Já marcou as aulas de hoje?",
      url: "/hoje",
      tag: "checkin_reminder",
      classes: [
        {
          subjectId: s.subjectId,
          scheduleId: s.scheduleId,
          classDate: "2026-11-18",
          name: "Física I",
        },
      ],
    });
  });

  it("semanal não leva aulas para botões (são vários dias)", async () => {
    const s = await student({
      prefs: { checkin_reminder: "weekly", checkin_time: "21:00", checkin_weekday: 3 },
    });
    await enqueueReminders(worker, WED_2110);
    const [inApp] = (await reminderLogs(s.userId)).filter((r) => r.channel === "in_app");
    expect(inApp?.payload).toEqual({ count: 1, scope: "week" });
  });
});

describe("despertador e limpeza", () => {
  it("o NOTIFY do commit acorda o worker na hora", async () => {
    let woke = 0;
    const listener = new OutboxListener(
      db.urls.app_worker,
      () => woke++,
      () => undefined,
    );
    await listener.start();
    const before = woke; // ao conectar ele já acorda uma vez
    const s = await student();
    await thresholdAlert(s);
    await expect.poll(() => woke, { timeout: 5_000 }).toBeGreaterThan(before);
    await listener.stop();
  });

  it("transação desfeita não acorda ninguém (o NOTIFY só sai no commit)", async () => {
    let woke = 0;
    const listener = new OutboxListener(
      db.urls.app_worker,
      () => woke++,
      () => undefined,
    );
    await listener.start();
    const s = await student();
    const before = woke;
    await expect(
      inTx(db.pools.app_api, { userId: s.userId }, async (c) => {
        await c.query(
          `insert into notification_logs (user_id, kind, channel, dedupe_key, payload)
           values ($1, 'system', 'email', $2, '{}')`,
          [s.userId, `rollback:${randomUUID()}`],
        );
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    await new Promise((r) => setTimeout(r, 500));
    expect(woke).toBe(before);
    await listener.stop();
  });

  it("apaga chaves de idempotência com mais de 24 h e sessões vencidas há uma semana", async () => {
    const s = await student();
    await db.admin.query(
      `insert into app.idempotency_keys (user_id, key, request_hash, status_code, created_at)
       values ($1, 'velha-123456', '\\x00', 201, now() - interval '25 hours'),
              ($1, 'nova-1234567', '\\x00', 201, now())`,
      [s.userId],
    );
    await db.admin.query(
      `insert into app.sessions (user_id, token_hash, created_at, last_seen_at, expires_at)
       values ($1, decode(repeat('01', 32), 'hex'), now() - interval '40 days', now() - interval '40 days', now() - interval '8 days'),
              ($1, decode(repeat('02', 32), 'hex'), now(), now(), now() + interval '1 day')`,
      [s.userId],
    );
    const stats = await cleanupExpired(worker);
    expect(stats.idempotencyKeys).toBeGreaterThanOrEqual(1);
    expect(stats.sessions).toBeGreaterThanOrEqual(1);
    const keys = await db.admin.query("select key from app.idempotency_keys where user_id = $1", [
      s.userId,
    ]);
    expect(keys.rows).toEqual([{ key: "nova-1234567" }]);
    const sessions = await db.admin.query(
      "select count(*)::int as n from app.sessions where user_id = $1",
      [s.userId],
    );
    expect(sessions.rows[0]).toEqual({ n: 1 });
  });
});

describe("ciclo único (modo once)", () => {
  it("um disparo entrega o que está na fila e limpa o que expirou; o seguinte não repete nada", async () => {
    const s = await student();
    const { email } = await thresholdAlert(s);
    await db.admin.query(
      `insert into app.idempotency_keys (user_id, key, request_hash, status_code, created_at)
       values ($1, 'expirada-once-1', '\\x00', 201, now() - interval '30 hours')`,
      [s.userId],
    );

    const first = await runCycle(deps(), { cleanup: true });
    expect(didWork(first)).toBe(true);
    expect(first.delivery.sent).toBeGreaterThanOrEqual(1);
    expect(first.cleanup?.idempotencyKeys).toBeGreaterThanOrEqual(1);
    expect(mail.lastTo(s.email)?.subject).toBe("Física I: 75% do limite de faltas");
    expect(await row(email!)).toMatchObject({ status: "sent", attempts: 1 });

    const sentBefore = mail.sent.length;
    const second = await runCycle(deps(), { cleanup: false });
    expect(second.cleanup).toBeNull();
    expect(second.delivery.sent).toBe(0);
    expect(mail.sent).toHaveLength(sentBefore);
  });
});
