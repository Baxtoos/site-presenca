import { randomUUID } from "node:crypto";
import {
  attendanceResultSchema,
  meResponseSchema,
  notificationListSchema,
  notificationPreferencesSchema,
  problemSchema,
  subjectSchema,
  unreadCountSchema,
} from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
  TEST_VAPID_PUBLIC_KEY,
} from "../test/auth-harness";

let env: AuthTestEnv;
beforeAll(async () => {
  env = await startAuthTestEnv();
});
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
const key = () => ({ "idempotency-key": randomUUID() });
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());

async function setup(opts: { verified?: boolean; maxUnits?: number } = {}) {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `avisos.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-dos-avisos-1",
    fullName: "Aluno Avisos",
  });
  expect(reg.statusCode).toBe(200);
  const userId = meResponseSchema.parse(reg.json()).id;
  if (opts.verified === false) {
    await env.db.admin.query("update app.users set email_verified_at = null where id = $1", [
      userId,
    ]);
  }
  const sem = await b.request("POST", "/v1/semesters", {
    label: `2026.${++seq}`,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    isCurrent: true,
  });
  const semesterId = sem.json<{ id: string }>().id;
  const sub = await b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
    name: "Física I",
    unitsPerClass: 1,
    countingMode: "manual",
    manualMaxUnits: opts.maxUnits ?? 10,
  });
  expect(sub.statusCode, sub.body).toBe(201);
  const subject = subjectSchema.parse(sub.json());
  return { b, userId, subject };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

let day = 0;
async function miss(c: Ctx, units: number) {
  const classDate = `2026-09-${String((++day % 28) + 1).padStart(2, "0")}`;
  const res = await c.b.request(
    "POST",
    "/v1/attendance",
    { subjectId: c.subject.id, classDate, status: "absent", unitsScheduled: units },
    { headers: key() },
  );
  expect(res.statusCode, res.body).toBe(201);
  return attendanceResultSchema.parse(res.json());
}

interface LogRow {
  channel: string;
  status: string;
  threshold_pct: number | null;
  cycle: number | null;
  dedupe_key: string;
  last_error: string | null;
}
async function logs(userId: string): Promise<LogRow[]> {
  return (
    await env.db.admin.query<LogRow>(
      `select channel, status, threshold_pct, cycle, dedupe_key, last_error
         from app.notification_logs where user_id = $1 order by threshold_pct, channel::text`,
      [userId],
    )
  ).rows;
}
const inbox = async (c: Ctx) =>
  notificationListSchema.parse((await c.b.request("GET", "/v1/notifications")).json());

describe("marcos de alerta", () => {
  it("cruzar 50%: aviso na central na hora, e-mail na fila; push desligado fica pulado", async () => {
    const c = await setup();
    await miss(c, 4);
    expect(await logs(c.userId)).toEqual([]);
    await miss(c, 1);

    expect(await logs(c.userId)).toEqual([
      expect.objectContaining({ channel: "email", status: "pending", threshold_pct: 50, cycle: 1 }),
      expect.objectContaining({ channel: "in_app", status: "sent", threshold_pct: 50, cycle: 1 }),
      expect.objectContaining({ channel: "push", status: "skipped", threshold_pct: 50 }),
    ]);
    const list = await inbox(c);
    expect(list.unreadCount).toBe(1);
    expect(list.items[0]).toMatchObject({
      kind: "threshold",
      subjectId: c.subject.id,
      title: "Física I: 50% do limite de faltas",
      body: "Você tem 5 de 10 faltas. Ainda pode faltar 5 aulas.",
      url: `/materias/${c.subject.id}`,
      readAt: null,
    });
  });

  it("apagar matéria ou semestre que já gerou alerta funciona e mantém o aviso no histórico", async () => {
    const c = await setup();
    await miss(c, 5);
    const del = await c.b.request("DELETE", `/v1/subjects/${c.subject.id}`, undefined, {
      headers: { "if-match": `"${c.subject.version}"` },
    });
    expect(del.statusCode, del.body).toBe(204);
    const kept = (await inbox(c)).items;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      kind: "threshold",
      subjectId: null,
      title: "Física I: 50% do limite de faltas",
      url: "/",
    });

    const d = await setup();
    await miss(d, 5);
    const sem = await d.b.request("DELETE", `/v1/semesters/${d.subject.semesterId}`, undefined, {
      headers: { "if-match": '"1"' },
    });
    expect(sem.statusCode, sem.body).toBe(204);
    expect((await inbox(d)).items.map((i) => i.subjectId)).toEqual([null]);
  });

  it("5 registros simultâneos cruzando o mesmo marco geram um único alerta", async () => {
    const c = await setup();
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        c.b.request(
          "POST",
          "/v1/attendance",
          {
            subjectId: c.subject.id,
            classDate: `2026-10-${10 + n}`,
            status: "absent",
            unitsScheduled: 1,
          },
          { headers: key() },
        ),
      ),
    );
    const rows = (await logs(c.userId)).filter((r) => r.channel === "in_app");
    expect(rows.map((r) => r.dedupe_key)).toEqual([`threshold:${c.subject.id}:50:1`]);
  });

  it("um salto que cruza vários marcos manda só o mais grave", async () => {
    const c = await setup({ maxUnits: 5 });
    await miss(c, 4);
    const rows = await logs(c.userId);
    const sent = rows.filter((r) => r.status !== "skipped");
    expect(sent.map((r) => [r.channel, r.threshold_pct])).toEqual([
      ["email", 75],
      ["in_app", 75],
    ]);
    expect(rows.find((r) => r.threshold_pct === 50)).toMatchObject({
      channel: "in_app",
      status: "skipped",
      last_error: "coberto pelo alerta de 75%",
    });
    expect((await inbox(c)).items.map((i) => i.title)).toEqual([
      "Física I: 75% do limite de faltas",
    ]);
  });

  it("não repete o aviso enquanto continua acima; rearma ao apagar a falta e avisa de novo", async () => {
    const c = await setup();
    const first = await miss(c, 6);
    await miss(c, 1);
    expect((await inbox(c)).items).toHaveLength(1);

    const del = await c.b.request("DELETE", `/v1/attendance/${first.record.id}`, undefined, {
      headers: ifMatch(first.record.version),
    });
    expect(del.statusCode).toBe(200);
    const state = await env.db.admin.query(
      "select armed, cycle from app.subject_threshold_state where subject_id = $1 and threshold_pct = 50",
      [c.subject.id],
    );
    expect(state.rows[0]).toEqual({ armed: true, cycle: 1 });

    await miss(c, 5);
    const titles = (await logs(c.userId))
      .filter((r) => r.channel === "in_app")
      .map((r) => r.dedupe_key);
    expect(titles).toEqual([`threshold:${c.subject.id}:50:1`, `threshold:${c.subject.id}:50:2`]);
    expect((await inbox(c)).unreadCount).toBe(2);
  });

  it("corrigir uma falta para presença (PATCH) também rearma", async () => {
    const c = await setup();
    const r = await miss(c, 5);
    const patch = await c.b.request(
      "PATCH",
      `/v1/attendance/${r.record.id}`,
      { status: "present" },
      { headers: ifMatch(r.record.version) },
    );
    expect(patch.statusCode, patch.body).toBe(200);
    const state = await env.db.admin.query(
      "select armed from app.subject_threshold_state where subject_id = $1 and threshold_pct = 50",
      [c.subject.id],
    );
    expect(state.rows[0]).toEqual({ armed: true });
  });

  it("mudar as regras da matéria (limite menor) cruza o marco sem falta nova", async () => {
    const c = await setup();
    await miss(c, 4);
    const put = await c.b.request(
      "PUT",
      `/v1/subjects/${c.subject.id}`,
      { name: "Física I", unitsPerClass: 1, countingMode: "manual", manualMaxUnits: 5 },
      { headers: ifMatch(c.subject.version) },
    );
    expect(put.statusCode, put.body).toBe(200);
    expect((await inbox(c)).items[0]?.title).toBe("Física I: 75% do limite de faltas");
  });

  it("limite atingido e ultrapassado: texto próprio do 100%", async () => {
    const c = await setup();
    await miss(c, 6);
    await miss(c, 6);
    const top = (await inbox(c)).items[0]!;
    expect(top.title).toBe("Física I: limite de faltas atingido");
    expect(top.body).toContain("passou do limite em 2 aulas (12 de 10)");
  });

  it("e-mail não confirmado: o e-mail fica pulado (com o motivo), a central recebe igual", async () => {
    const c = await setup({ verified: false });
    await miss(c, 5);
    const rows = await logs(c.userId);
    expect(rows.find((r) => r.channel === "email")).toMatchObject({
      status: "skipped",
      last_error: "e-mail não confirmado",
    });
    expect((await inbox(c)).unreadCount).toBe(1);
  });

  it("marco desligado nas preferências não avisa; push ligado entra na fila", async () => {
    const c = await setup();
    const put = await c.b.request("PUT", "/v1/notification-preferences", {
      emailEnabled: false,
      pushEnabled: true,
      thresholds: [90, 75],
      checkinReminder: "off",
      checkinTime: "21:00",
      checkinWeekday: 5,
      quietStart: null,
      quietEnd: null,
    });
    expect(put.statusCode, put.body).toBe(200);
    await miss(c, 5);
    expect(await logs(c.userId)).toEqual([]);
    await miss(c, 3);
    const rows = await logs(c.userId);
    expect(rows.map((r) => [r.channel, r.status, r.threshold_pct])).toEqual([
      ["email", "skipped", 75],
      ["in_app", "sent", 75],
      ["push", "pending", 75],
    ]);
  });

  it("repetir o registro (mesma Idempotency-Key) não duplica o alerta; corpo diferente não deixa rastro", async () => {
    const c = await setup();
    const headers = { "idempotency-key": randomUUID() };
    const body = {
      subjectId: c.subject.id,
      classDate: "2026-10-05",
      status: "absent",
      unitsScheduled: 5,
    };
    expect((await c.b.request("POST", "/v1/attendance", body, { headers })).statusCode).toBe(201);
    const after = await logs(c.userId);
    expect(after).toHaveLength(3);
    const replay = await c.b.request("POST", "/v1/attendance", body, { headers });
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    const reused = await c.b.request(
      "POST",
      "/v1/attendance",
      { ...body, unitsScheduled: 9 },
      { headers },
    );
    expect(reused.statusCode).toBe(422);
    expect(await logs(c.userId)).toEqual(after);
  });
});

describe("central de avisos", () => {
  it("marca um como lido, depois todos; não lidos acompanham", async () => {
    const c = await setup();
    await miss(c, 5);
    await miss(c, 3);
    let list = await inbox(c);
    expect(list.unreadCount).toBe(2);
    const read = await c.b.request("POST", `/v1/notifications/${list.items[0]!.id}/read`);
    expect(unreadCountSchema.parse(read.json())).toEqual({ unreadCount: 1 });
    list = await inbox(c);
    expect(list.items[0]!.readAt).not.toBeNull();
    const all = await c.b.request("POST", "/v1/notifications/read-all");
    expect(all.json()).toEqual({ unreadCount: 0 });
    expect((await inbox(c)).unreadCount).toBe(0);
  });

  it("pagina por cursor, do mais recente ao mais antigo", async () => {
    const c = await setup({ maxUnits: 4 });
    await miss(c, 2);
    await miss(c, 1);
    await miss(c, 1);
    expect((await c.b.request("POST", "/v1/notifications/test")).statusCode).toBe(202);
    const first = notificationListSchema.parse(
      (await c.b.request("GET", "/v1/notifications?limit=3")).json(),
    );
    expect(first.items).toHaveLength(3);
    expect(first.items[0]!.title).toBe("Aviso de teste");
    expect(first.nextCursor).not.toBeNull();
    const second = notificationListSchema.parse(
      (await c.b.request("GET", `/v1/notifications?limit=3&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((i) => i.title)).toEqual(["Física I: 50% do limite de faltas"]);
    expect(second.nextCursor).toBeNull();
  });

  it("aviso de teste: limite de um a cada 20 s", async () => {
    const c = await setup();
    expect((await c.b.request("POST", "/v1/notifications/test")).statusCode).toBe(202);
    const again = await c.b.request("POST", "/v1/notifications/test");
    expect(again.statusCode).toBe(429);
  });

  it("um aluno nunca vê nem marca os avisos de outro", async () => {
    const ana = await setup();
    const bia = await setup();
    await miss(ana, 5);
    const anaItem = (await inbox(ana)).items[0]!;
    expect((await inbox(bia)).items).toEqual([]);
    const steal = await bia.b.request("POST", `/v1/notifications/${anaItem.id}/read`);
    expect(steal.statusCode).toBe(404);
    expect((await inbox(ana)).unreadCount).toBe(1);
  });
});

describe("preferências e push", () => {
  it("padrões sem linha gravada; salvar normaliza os marcos", async () => {
    const c = await setup({ verified: false });
    const prefs = notificationPreferencesSchema.parse(
      (await c.b.request("GET", "/v1/notification-preferences")).json(),
    );
    expect(prefs).toEqual({
      emailEnabled: true,
      pushEnabled: false,
      thresholds: [50, 75, 90, 100],
      checkinReminder: "off",
      checkinTime: "21:00",
      checkinWeekday: 5,
      quietStart: null,
      quietEnd: null,
      emailVerified: false,
      vapidPublicKey: TEST_VAPID_PUBLIC_KEY,
      pushDevices: 0,
    });
    const saved = await c.b.request("PUT", "/v1/notification-preferences", {
      ...prefs,
      thresholds: [100, 50, 50],
      checkinReminder: "daily",
      checkinTime: "20:30",
      quietStart: "22:00",
      quietEnd: "07:00",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      thresholds: [50, 100],
      checkinReminder: "daily",
      checkinTime: "20:30",
      quietStart: "22:00",
      quietEnd: "07:00",
    });
  });

  it("recusa horário silencioso pela metade e marco inexistente", async () => {
    const c = await setup();
    const base = {
      emailEnabled: true,
      pushEnabled: false,
      thresholds: [50],
      checkinReminder: "off",
      checkinTime: "21:00",
      checkinWeekday: 5,
      quietStart: "22:00",
      quietEnd: null,
    };
    const half = await c.b.request("PUT", "/v1/notification-preferences", base);
    expect(half.statusCode).toBe(422);
    expect(problem(half).errors?.[0]?.path).toBe("quietEnd");
    const bad = await c.b.request("PUT", "/v1/notification-preferences", {
      ...base,
      quietEnd: "07:00",
      thresholds: [60],
    });
    expect(bad.statusCode).toBe(422);
  });

  const subscription = (n: number) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${n}-${randomUUID()}`,
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  });

  it("registrar o aparelho liga o push; registrar de novo atualiza; remover desconta", async () => {
    const c = await setup();
    const sub = subscription(1);
    const first = await c.b.request("POST", "/v1/push-subscriptions", sub, {
      headers: { "user-agent": "Teste/1.0" },
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toEqual({ pushDevices: 1 });
    const again = await c.b.request("POST", "/v1/push-subscriptions", {
      ...sub,
      keys: { p256dh: "C".repeat(87), auth: "b".repeat(22) },
    });
    expect(again.json()).toEqual({ pushDevices: 1 });
    const prefs = notificationPreferencesSchema.parse(
      (await c.b.request("GET", "/v1/notification-preferences")).json(),
    );
    expect(prefs).toMatchObject({ pushEnabled: true, pushDevices: 1 });
    const removed = await c.b.request("DELETE", "/v1/push-subscriptions", {
      endpoint: sub.endpoint,
    });
    expect(removed.json()).toEqual({ pushDevices: 0 });
  });

  it("endereço de push de outra conta: 409 (não sequestra o aparelho de ninguém)", async () => {
    const ana = await setup();
    const bia = await setup();
    const sub = subscription(2);
    expect((await ana.b.request("POST", "/v1/push-subscriptions", sub)).statusCode).toBe(201);
    const taken = await bia.b.request("POST", "/v1/push-subscriptions", sub);
    expect(taken.statusCode).toBe(409);
    expect(problem(taken).code).toBe("PUSH_ENDPOINT_IN_USE");
    await bia.b.request("DELETE", "/v1/push-subscriptions", { endpoint: sub.endpoint });
    const owner = await env.db.admin.query(
      "select user_id from app.push_subscriptions where endpoint = $1",
      [sub.endpoint],
    );
    expect(owner.rows[0]).toEqual({ user_id: ana.userId });
  });

  it.each([
    ["sem HTTPS", "http://fcm.googleapis.com/fcm/send/x"],
    ["serviço desconhecido", "https://push.exemplo.com/x"],
    ["rede interna (SSRF)", "https://169.254.169.254/latest/meta-data"],
    ["porta fora do padrão", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["domínio parecido", "https://fcm.googleapis.com.evil.example/x"],
  ])("endereço de push recusado: %s", async (_label, endpoint) => {
    const c = await setup();
    const res = await c.b.request("POST", "/v1/push-subscriptions", {
      ...subscription(3),
      endpoint,
    });
    expect(res.statusCode).toBe(422);
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("serviço de push dos navegadores aceito: %s", async (endpoint) => {
    const c = await setup();
    const res = await c.b.request("POST", "/v1/push-subscriptions", {
      ...subscription(4),
      endpoint,
    });
    expect(res.statusCode, res.body).toBe(201);
  });
});
