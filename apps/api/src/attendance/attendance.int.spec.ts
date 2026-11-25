import { randomUUID } from "node:crypto";
import {
  type AttendanceResult,
  attendanceListSchema,
  attendanceResultSchema,
  subjectEvolutionSchema,
  meResponseSchema,
  problemSchema,
  simulateResponseSchema,
  subjectCalendarSchema,
  subjectSchema,
  todayResponseSchema,
} from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
} from "../test/auth-harness";

let env: AuthTestEnv;
beforeAll(async () => {
  env = await startAuthTestEnv();
});
afterAll(async () => {
  await env?.stop();
});

// "Hoje" nos testes: quarta-feira, 18/11/2026, 12:00 em São Paulo.
const TODAY = "2026-11-18";
const MONDAY = "2026-11-16";

let seq = 0;
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());
const key = () => ({ "idempotency-key": randomUUID() });
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });

const CALCULO = {
  name: "Cálculo II",
  unitsPerClass: 2,
  countingMode: "workload",
  workloadHours: 60,
  workloadHourMinutes: 60,
  unitMinutes: 50, // T = 72 tempos, F = 18 tempos (75%)
  minAttendanceBp: 7500,
  schedules: [
    { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
    { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
  ],
};

/** Aluna com semestre 2026.2 e Cálculo II (segunda e quarta, 2 tempos). */
async function setup(subjectOverrides: Record<string, unknown> = {}) {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `presenca.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-da-presenca-1",
    fullName: "Aluna Presença",
  });
  expect(reg.statusCode).toBe(200);
  const userId = meResponseSchema.parse(reg.json()).id;
  const sem = await b.request("POST", "/v1/semesters", {
    label: `2026.${++seq}`,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    isCurrent: true,
  });
  const semesterId = sem.json<{ id: string }>().id;
  const sub = await b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
    ...CALCULO,
    ...subjectOverrides,
  });
  expect(sub.statusCode).toBe(201);
  const subject = subjectSchema.parse(sub.json());
  const wed = subject.schedules.find((s) => s.weekday === 3)!;
  const mon = subject.schedules.find((s) => s.weekday === 1)!;
  return { b, userId, semesterId, subject, wed, mon };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** Registra uma aula (padrão: aula extra, para poder usar qualquer data do semestre). */
function register(c: Ctx, body: Record<string, unknown>, headers: Record<string, string> = key()) {
  return c.b.request(
    "POST",
    "/v1/attendance",
    { subjectId: c.subject.id, status: "absent", ...body },
    { headers },
  );
}
const registered = async (c: Ctx, body: Record<string, unknown>) => {
  const res = await register(c, body);
  expect(res.statusCode, res.body).toBe(201);
  return attendanceResultSchema.parse(res.json());
};
const countLogs = async (subjectId: string) =>
  Number(
    (
      await env.db.admin.query("select count(*) from app.attendance_logs where subject_id = $1", [
        subjectId,
      ])
    ).rows[0].count,
  );

describe("aulas de hoje", () => {
  it("lista as aulas da grade do dia, sem registro, com o resumo da matéria", async () => {
    const c = await setup();
    const res = await c.b.request("GET", "/v1/today");
    expect(res.statusCode).toBe(200);
    const today = todayResponseSchema.parse(res.json());
    expect(today).toMatchObject({ date: TODAY, weekday: 3, isToday: true, exceptions: [] });
    expect(today.classes).toHaveLength(1);
    expect(today.classes[0]).toMatchObject({
      subject: { id: c.subject.id, name: "Cálculo II", unitsPerClass: 2 },
      scheduleId: c.wed.id,
      startsAt: "19:00",
      endsAt: "20:40",
      units: 2,
      room: "B-204",
      blocked: null,
      record: null,
      summary: { absentUnits: 0, maxAbsenceUnits: 18, remainingUnits: 18, risk: "safe" },
    });
  });

  it("dia sem aula na grade vem vazio; data futura é recusada", async () => {
    const c = await setup();
    const tuesday = todayResponseSchema.parse(
      (await c.b.request("GET", "/v1/today?date=2026-11-17")).json(),
    );
    expect(tuesday.classes).toEqual([]);
    const future = await c.b.request("GET", "/v1/today?date=2026-11-19");
    expect(future.statusCode).toBe(422);
    expect(problem(future).code).toBe("FUTURE_DATE");
  });

  it("navega para um dia passado e mostra o registro já feito", async () => {
    const c = await setup();
    await registered(c, { classDate: MONDAY, scheduleId: c.mon.id });
    const monday = todayResponseSchema.parse(
      (await c.b.request("GET", `/v1/today?date=${MONDAY}`)).json(),
    );
    expect(monday).toMatchObject({ date: MONDAY, weekday: 1, isToday: false });
    expect(monday.classes[0]!.record).toMatchObject({
      status: "absent",
      unitsMissed: 2,
      scheduleId: c.mon.id,
    });
  });

  it("feriado cancela a aula do dia; semana de provas só avisa", async () => {
    const c = await setup();
    const exc = (body: Record<string, unknown>) =>
      c.b.request("POST", `/v1/semesters/${c.semesterId}/exceptions`, body);
    await exc({ startsOn: TODAY, endsOn: TODAY, kind: "holiday", label: "Dia do Evento" });
    await exc({ startsOn: TODAY, endsOn: TODAY, kind: "exam_week", label: "Provas" });
    const today = todayResponseSchema.parse((await c.b.request("GET", "/v1/today")).json());
    expect(today.classes[0]!.blocked).toEqual({ kind: "holiday", label: "Dia do Evento" });
    expect(today.exceptions.map((e) => e.label).sort()).toEqual(["Dia do Evento", "Provas"]);
  });

  it("exceção de uma matéria não cancela as outras", async () => {
    const c = await setup();
    const fisica = subjectSchema.parse(
      (
        await c.b.request("POST", `/v1/semesters/${c.semesterId}/subjects`, {
          ...CALCULO,
          name: "Física",
          schedules: [{ weekday: 3, startsAt: "21:00", endsAt: "22:40", units: 2 }],
        })
      ).json(),
    );
    await c.b.request("POST", `/v1/semesters/${c.semesterId}/exceptions`, {
      startsOn: TODAY,
      endsOn: TODAY,
      kind: "no_classes",
      label: "Professor ausente",
      subjectId: fisica.id,
    });
    const today = todayResponseSchema.parse((await c.b.request("GET", "/v1/today")).json());
    expect(today.classes.map((x) => [x.subject.name, x.blocked?.label ?? null])).toEqual([
      ["Cálculo II", null],
      ["Física", "Professor ausente"],
    ]);
  });

  it("aula extra aparece depois das aulas da grade", async () => {
    const c = await setup();
    await registered(c, { classDate: TODAY, status: "present" });
    const today = todayResponseSchema.parse((await c.b.request("GET", "/v1/today")).json());
    expect(today.classes).toHaveLength(2);
    expect(today.classes[1]).toMatchObject({
      scheduleId: null,
      startsAt: null,
      record: { status: "present" },
    });
  });

  it("usa o dia do fuso do aluno: às 00:30 de Tóquio já é quinta", async () => {
    const c = await setup();
    await c.b.request("PATCH", "/v1/me", { timezone: "Asia/Tokyo" });
    env.clock.instant = new Date("2026-11-18T15:30:00Z"); // 19/11 00:30 em Tóquio
    try {
      const today = todayResponseSchema.parse((await c.b.request("GET", "/v1/today")).json());
      expect(today).toMatchObject({ date: "2026-11-19", weekday: 4 });
      // Registrar em 19/11 não é "futuro" para quem está em Tóquio.
      expect((await register(c, { classDate: "2026-11-19" })).statusCode).toBe(201);
    } finally {
      env.clock.instant = new Date("2026-11-18T15:00:00Z");
    }
  });
});

describe("registrar presença", () => {
  it("falta total: perde todos os tempos e o resumo já vem recalculado", async () => {
    const c = await setup();
    const res = await register(c, {
      classDate: TODAY,
      scheduleId: c.wed.id,
      status: "absent",
      reason: "health",
      note: "Consulta",
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    const { record, summary } = attendanceResultSchema.parse(res.json());
    expect(record).toMatchObject({
      status: "absent",
      unitsScheduled: 2,
      unitsMissed: 2,
      isExcused: false,
      reason: "health",
      note: "Consulta",
      version: 1,
    });
    expect(summary).toMatchObject({
      absentUnits: 2,
      remainingUnits: 16,
      remainingClasses: 8,
      heldUnits: 2,
      risk: "safe",
    });
    // A rota da matéria enxerga a mesma conta: nada é guardado, tudo é derivado.
    const direct = subjectSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}`)).json(),
    );
    expect(direct.summary).toEqual(summary);
  });

  it("conteúdo da aula: grava ao registrar, edita, apaga com vazio e recusa texto longo demais", async () => {
    const c = await setup();
    const r = await registered(c, {
      classDate: "2026-09-02",
      status: "present",
      content: "  Derivadas e regra da cadeia  ",
    });
    expect(r.record.content).toBe("Derivadas e regra da cadeia");
    const edited = await c.b.request(
      "PATCH",
      `/v1/attendance/${r.record.id}`,
      { content: "Derivadas, regra da cadeia e lista 4" },
      { headers: { "if-match": `"${r.record.version}"` } },
    );
    expect(edited.statusCode, edited.body).toBe(200);
    const after = attendanceResultSchema.parse(edited.json()).record;
    expect(after).toMatchObject({
      content: "Derivadas, regra da cadeia e lista 4",
      status: "present",
    });
    const cleared = await c.b.request(
      "PATCH",
      `/v1/attendance/${r.record.id}`,
      { content: "" },
      { headers: { "if-match": `"${after.version}"` } },
    );
    expect(attendanceResultSchema.parse(cleared.json()).record.content).toBeNull();
    const tooLong = await register(c, { classDate: "2026-09-09", content: "x".repeat(2001) });
    expect(tooLong.statusCode).toBe(422);
  });

  it("evolução: faltas que contam acumuladas por dia, fechando com o resumo da matéria", async () => {
    const c = await setup();
    await registered(c, { classDate: "2026-09-02", status: "absent" });
    await registered(c, { classDate: "2026-09-09", status: "present" });
    const last = await registered(c, { classDate: "2026-09-16", status: "absent" });
    const res = await c.b.request("GET", `/v1/subjects/${c.subject.id}/evolution`);
    expect(res.statusCode, res.body).toBe(200);
    const evo = subjectEvolutionSchema.parse(res.json());
    expect(evo.semester).toEqual({ startsOn: "2026-08-03", endsOn: "2026-12-18" });
    expect(evo.absences.points.map((p) => p.date)).toEqual(["2026-09-02", "2026-09-16"]);
    expect(evo.absences.points.at(-1)!.total).toBe(last.summary.absentUnits);
    expect(evo.absences.limit).toBe(last.summary.maxAbsenceUnits);
    expect(evo.grades).toBeNull(); // sem regra de nota
    const other = await setup();
    expect(
      (await other.b.request("GET", `/v1/subjects/${c.subject.id}/evolution`)).statusCode,
    ).toBe(404);
  });

  it("falta parcial perde só os tempos informados", async () => {
    const c = await setup();
    const { record, summary } = await registered(c, {
      classDate: TODAY,
      scheduleId: c.wed.id,
      status: "partial",
      unitsMissed: 1,
    });
    expect(record).toMatchObject({ status: "partial", unitsScheduled: 2, unitsMissed: 1 });
    expect(summary.absentUnits).toBe(1);
  });

  it("presença e aula cancelada não perdem tempo; cancelada nem entra nas aulas dadas", async () => {
    const c = await setup();
    await registered(c, { classDate: MONDAY, scheduleId: c.mon.id, status: "present" });
    const { summary } = await registered(c, {
      classDate: TODAY,
      scheduleId: c.wed.id,
      status: "cancelled",
    });
    expect(summary).toMatchObject({ absentUnits: 0, heldUnits: 2 }); // só a segunda conta como dada
  });

  it("sem chamada: a aula conta como dada, mas sem falta; não aceita tempos perdidos nem atestado", async () => {
    const c = await setup();
    await registered(c, { classDate: MONDAY, scheduleId: c.mon.id, status: "present" });
    const { record, summary } = await registered(c, {
      classDate: TODAY,
      scheduleId: c.wed.id,
      status: "no_call",
    });
    expect(record).toMatchObject({ status: "no_call", unitsMissed: 0, isExcused: false });
    expect(summary).toMatchObject({ absentUnits: 0, heldUnits: 4 }); // as duas contam como dadas

    const withMissed = await register(c, { classDate: MONDAY, status: "no_call", unitsMissed: 1 });
    expect(withMissed.statusCode).toBe(422);
    const excused = await register(c, { classDate: MONDAY, status: "no_call", isExcused: true });
    expect(excused.statusCode).toBe(422);
  });

  it("atestado: com a política 'conta no limite' soma; com 'abona' não soma, mas fica registrado", async () => {
    const track = await setup();
    const t = await registered(track, {
      classDate: TODAY,
      scheduleId: track.wed.id,
      isExcused: true,
    });
    expect(t.summary).toMatchObject({ absentUnits: 2, excusedUnits: 2 });

    const deduct = await setup({ excusedPolicy: "deduct" });
    const d = await registered(deduct, {
      classDate: TODAY,
      scheduleId: deduct.wed.id,
      isExcused: true,
    });
    expect(d.summary).toMatchObject({ absentUnits: 0, excusedUnits: 2, remainingUnits: 18 });
  });

  it("aula extra usa os tempos da matéria, ou os informados", async () => {
    const c = await setup();
    expect((await registered(c, { classDate: "2026-09-01" })).record.unitsScheduled).toBe(2);
    expect(
      (await registered(c, { classDate: "2026-09-02", unitsScheduled: 4 })).record,
    ).toMatchObject({
      unitsScheduled: 4,
      unitsMissed: 4,
    });
  });

  it.each([
    ["data no futuro", { classDate: "2026-11-19" }, "FUTURE_DATE", "classDate"],
    ["data antes do semestre", { classDate: "2026-07-31" }, "OUT_OF_SEMESTER", "classDate"],
    [
      "horário em outro dia da semana",
      { classDate: "2026-11-17", scheduleId: "wed" },
      "SCHEDULE_NOT_FOUND",
      "scheduleId",
    ],
    [
      "horário que não existe",
      { classDate: TODAY, scheduleId: randomUUID() },
      "SCHEDULE_NOT_FOUND",
      "scheduleId",
    ],
  ] as [string, Record<string, unknown>, string, string][])(
    "recusa %s com 422",
    async (_label, body, code, path) => {
      const c = await setup();
      const payload = {
        ...body,
        scheduleId: body.scheduleId === "wed" ? c.wed.id : body.scheduleId,
      };
      const res = await register(c, payload);
      expect(res.statusCode).toBe(422);
      expect(problem(res).code).toBe(code);
      expect(problem(res).errors?.[0]?.path).toBe(path);
      expect(await countLogs(c.subject.id)).toBe(0);
    },
  );

  it.each([
    ["parcial sem dizer quantos tempos", { status: "partial" }, "unitsMissed"],
    ["parcial perdendo todos os tempos", { status: "partial", unitsMissed: 2 }, "unitsMissed"],
    ["tempos perdidos numa falta total", { status: "absent", unitsMissed: 1 }, "unitsMissed"],
    ["presença abonada", { status: "present", isExcused: true }, "isExcused"],
    ["observação enorme", { note: "x".repeat(501) }, "note"],
  ])("recusa %s", async (_label, body, path) => {
    const c = await setup();
    const res = await register(c, { classDate: TODAY, scheduleId: c.wed.id, ...body });
    expect(res.statusCode).toBe(422);
    expect(problem(res).errors?.map((e) => e.path)).toContain(path);
  });

  it("aula de 1 tempo não tem falta parcial", async () => {
    const c = await setup({
      unitsPerClass: 1,
      schedules: [{ weekday: 3, startsAt: "08:00", endsAt: "08:50", units: 1 }],
    });
    const res = await register(c, { classDate: TODAY, status: "partial", unitsMissed: 1 });
    expect(res.statusCode).toBe(422);
    expect(problem(res).errors?.[0]?.message).toContain("falta total");
  });

  it("segunda chamada para a mesma aula é conflito (e não cria outro registro)", async () => {
    const c = await setup();
    await registered(c, { classDate: TODAY, scheduleId: c.wed.id });
    const again = await register(c, { classDate: TODAY, scheduleId: c.wed.id, status: "present" });
    expect(again.statusCode).toBe(409);
    expect(problem(again).code).toBe("ATTENDANCE_CONFLICT");
    expect(await countLogs(c.subject.id)).toBe(1);
    // A aula extra do mesmo dia é outra ocorrência.
    expect((await register(c, { classDate: TODAY })).statusCode).toBe(201);
    expect((await register(c, { classDate: TODAY })).statusCode).toBe(409);
  });
});

describe("Idempotency-Key", () => {
  it("sem a chave: 428", async () => {
    const c = await setup();
    const res = await register(c, { classDate: TODAY }, {});
    expect(res.statusCode).toBe(428);
    expect(problem(res).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("repetir a chamada devolve a mesma resposta e não grava de novo", async () => {
    const c = await setup();
    const headers = key();
    const first = await register(c, { classDate: TODAY, scheduleId: c.wed.id }, headers);
    const second = await register(c, { classDate: TODAY, scheduleId: c.wed.id }, headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    expect(await countLogs(c.subject.id)).toBe(1);
  });

  it("a ordem das chaves do corpo não importa", async () => {
    const c = await setup();
    const headers = key();
    const a = await c.b.request(
      "POST",
      "/v1/attendance",
      { subjectId: c.subject.id, classDate: TODAY, status: "absent" },
      { headers },
    );
    const b = await c.b.request(
      "POST",
      "/v1/attendance",
      { status: "absent", classDate: TODAY, subjectId: c.subject.id },
      { headers },
    );
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.json()).toEqual(a.json());
  });

  it("a mesma chave com outro conteúdo é recusada", async () => {
    const c = await setup();
    const headers = key();
    await register(c, { classDate: TODAY, status: "absent" }, headers);
    const reused = await register(c, { classDate: TODAY, status: "present" }, headers);
    expect(reused.statusCode).toBe(422);
    expect(problem(reused).code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await countLogs(c.subject.id)).toBe(1);
  });

  it("cinco cliques simultâneos com a mesma chave gravam uma vez só", async () => {
    const c = await setup();
    const headers = key();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        register(c, { classDate: TODAY, scheduleId: c.wed.id }, headers),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.json<AttendanceResult>().record.id)).size).toBe(1);
    expect(responses.filter((r) => r.headers["idempotent-replayed"] === "true")).toHaveLength(4);
    expect(await countLogs(c.subject.id)).toBe(1);
  });

  it("erro não é memorizado: corrigido o problema, a mesma chave funciona", async () => {
    const c = await setup();
    await registered(c, { classDate: TODAY, scheduleId: c.wed.id });
    const headers = key();
    const conflict = await register(c, { classDate: TODAY, scheduleId: c.wed.id }, headers);
    expect(conflict.statusCode).toBe(409);
    // Apaga o registro que causava o conflito e repete a MESMA chave e o MESMO corpo.
    const existing = (await c.b.request("GET", `/v1/subjects/${c.subject.id}/attendance`)).json<{
      records: { id: string; version: number }[];
    }>();
    await c.b.request("DELETE", `/v1/attendance/${existing.records[0]!.id}`, undefined, {
      headers: ifMatch(1),
    });
    expect(
      (await register(c, { classDate: TODAY, scheduleId: c.wed.id }, headers)).statusCode,
    ).toBe(201);
  });

  it("chave com mais de 24 h vale como nova", async () => {
    const c = await setup();
    const headers = key();
    await register(c, { classDate: "2026-09-01" }, headers);
    await env.db.admin.query(
      "update app.idempotency_keys set created_at = now() - interval '25 hours' where key = $1",
      [headers["idempotency-key"]],
    );
    const res = await register(c, { classDate: "2026-09-02" }, headers); // corpo diferente, mas a chave expirou
    expect(res.statusCode).toBe(201);
    expect(await countLogs(c.subject.id)).toBe(2);
  });

  it("a chave é por aluno: outra pessoa pode usar o mesmo valor", async () => {
    const a = await setup();
    const b = await setup();
    const headers = key();
    expect((await register(a, { classDate: TODAY }, headers)).statusCode).toBe(201);
    const other = await register(b, { classDate: TODAY }, headers);
    expect(other.statusCode).toBe(201);
    expect(other.headers["idempotent-replayed"]).toBeUndefined();
  });
});

describe("corrigir e apagar registros", () => {
  it("troca falta por presença e o saldo volta; versão sobe", async () => {
    const c = await setup();
    const { record } = await registered(c, { classDate: TODAY, scheduleId: c.wed.id });
    const res = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "present" },
      { headers: ifMatch(1) },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"2"');
    const out = attendanceResultSchema.parse(res.json());
    expect(out.record).toMatchObject({ status: "present", unitsMissed: 0, version: 2 });
    expect(out.summary).toMatchObject({ absentUnits: 0, remainingUnits: 18 });
  });

  it("de presença para falta parcial exige os tempos; para falta total perde todos", async () => {
    const c = await setup();
    const { record } = await registered(c, {
      classDate: TODAY,
      scheduleId: c.wed.id,
      status: "present",
    });
    const noUnits = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "partial" },
      { headers: ifMatch(1) },
    );
    expect(noUnits.statusCode).toBe(422);
    const partial = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "partial", unitsMissed: 1 },
      { headers: ifMatch(1) },
    );
    expect(attendanceResultSchema.parse(partial.json()).record).toMatchObject({
      unitsMissed: 1,
      version: 2,
    });
    const total = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "absent" },
      { headers: ifMatch(2) },
    );
    expect(attendanceResultSchema.parse(total.json()).record).toMatchObject({
      status: "absent",
      unitsMissed: 2,
      version: 3,
    });
  });

  it("atestado, motivo e observação são editáveis; ao virar presença, são limpos", async () => {
    const c = await setup();
    const { record } = await registered(c, { classDate: TODAY, scheduleId: c.wed.id });
    const edit = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { isExcused: true, reason: "work", note: "Atestado entregue" },
      { headers: ifMatch(1) },
    );
    expect(attendanceResultSchema.parse(edit.json()).record).toMatchObject({
      isExcused: true,
      reason: "work",
      note: "Atestado entregue",
    });
    const back = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "present" },
      { headers: ifMatch(2) },
    );
    expect(attendanceResultSchema.parse(back.json()).record).toMatchObject({
      isExcused: false,
      reason: null,
      note: "Atestado entregue",
    });
  });

  it("não deixa abonar presença", async () => {
    const c = await setup();
    const { record } = await registered(c, {
      classDate: TODAY,
      scheduleId: c.wed.id,
      status: "present",
    });
    const res = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { isExcused: true },
      { headers: ifMatch(1) },
    );
    expect(res.statusCode).toBe(422);
  });

  it("exige If-Match; versão velha é 412 e não altera nada", async () => {
    const c = await setup();
    const { record } = await registered(c, { classDate: TODAY, scheduleId: c.wed.id });
    expect(
      (await c.b.request("PATCH", `/v1/attendance/${record.id}`, { status: "present" })).statusCode,
    ).toBe(428);
    await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { note: "outro aparelho" },
      { headers: ifMatch(1) },
    );
    const stale = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "present" },
      { headers: ifMatch(1) },
    );
    expect(stale.statusCode).toBe(412);
    expect(problem(stale).code).toBe("VERSION_MISMATCH");
    const list = attendanceListSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/attendance`)).json(),
    );
    expect(list.records[0]).toMatchObject({ status: "absent", note: "outro aparelho", version: 2 });
  });

  it("apagar (desfazer) devolve o resumo recalculado", async () => {
    const c = await setup();
    const { record } = await registered(c, { classDate: TODAY, scheduleId: c.wed.id });
    expect((await c.b.request("DELETE", `/v1/attendance/${record.id}`)).statusCode).toBe(428);
    expect(
      (
        await c.b.request("DELETE", `/v1/attendance/${record.id}`, undefined, {
          headers: ifMatch(9),
        })
      ).statusCode,
    ).toBe(412);
    const res = await c.b.request("DELETE", `/v1/attendance/${record.id}`, undefined, {
      headers: ifMatch(1),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ summary: { absentUnits: number } }>().summary.absentUnits).toBe(0);
    expect(
      (
        await c.b.request("DELETE", `/v1/attendance/${record.id}`, undefined, {
          headers: ifMatch(1),
        })
      ).statusCode,
    ).toBe(404);
    // Depois de desfeito, a aula pode ser registrada de novo.
    expect((await register(c, { classDate: TODAY, scheduleId: c.wed.id })).statusCode).toBe(201);
  });

  it("toda alteração fica na trilha de auditoria, com o request id", async () => {
    const c = await setup();
    const created = await register(c, { classDate: TODAY, scheduleId: c.wed.id });
    const { record } = attendanceResultSchema.parse(created.json());
    const patched = await c.b.request(
      "PATCH",
      `/v1/attendance/${record.id}`,
      { status: "present" },
      { headers: ifMatch(1) },
    );
    const deleted = await c.b.request("DELETE", `/v1/attendance/${record.id}`, undefined, {
      headers: ifMatch(2),
    });
    const events = (
      await env.db.admin.query(
        "select action, request_id, after->>'status' as depois from app.attendance_log_events where log_id = $1 order by id",
        [record.id],
      )
    ).rows;
    expect(events).toEqual([
      { action: "insert", request_id: created.headers["x-request-id"], depois: "absent" },
      { action: "update", request_id: patched.headers["x-request-id"], depois: "present" },
      { action: "delete", request_id: deleted.headers["x-request-id"], depois: null },
    ]);
  });
});

describe("histórico paginado", () => {
  it("percorre tudo por cursor, do mais recente ao mais antigo, sem repetir nem pular", async () => {
    const c = await setup();
    const dates = [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-08",
      "2026-09-09",
    ];
    for (const classDate of dates) await registered(c, { classDate });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/subjects/${c.subject.id}/attendance?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const page = attendanceListSchema.parse((await c.b.request("GET", url)).json());
      seen.push(...page.records.map((r) => r.classDate));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...dates].reverse());
  });

  it("duas aulas no mesmo dia (horário + aula extra) não se perdem nem se repetem entre páginas", async () => {
    const c = await setup();
    // 09/09/2026 é quarta: o horário da grade e uma aula extra são ocorrências diferentes do mesmo dia.
    const scheduled = await registered(c, { classDate: "2026-09-09", scheduleId: c.wed.id });
    const extra = await registered(c, { classDate: "2026-09-09" });
    await registered(c, { classDate: "2026-09-08" });

    const first = attendanceListSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/attendance?limit=1`)).json(),
    );
    const second = attendanceListSchema.parse(
      (
        await c.b.request(
          "GET",
          `/v1/subjects/${c.subject.id}/attendance?limit=1&cursor=${first.nextCursor}`,
        )
      ).json(),
    );
    const third = attendanceListSchema.parse(
      (
        await c.b.request(
          "GET",
          `/v1/subjects/${c.subject.id}/attendance?limit=1&cursor=${second.nextCursor}`,
        )
      ).json(),
    );
    const ids = [first, second, third].map((p) => p.records[0]!.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.slice(0, 2).sort()).toEqual([scheduled.record.id, extra.record.id].sort());
    expect(third.nextCursor).toBeNull();
  });

  it("filtra por status e recusa cursor inválido", async () => {
    const c = await setup();
    await registered(c, { classDate: "2026-09-01", status: "present" });
    await registered(c, { classDate: "2026-09-02", status: "absent" });
    const onlyAbsent = attendanceListSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/attendance?status=absent`)).json(),
    );
    expect(onlyAbsent.records.map((r) => r.status)).toEqual(["absent"]);
    const bad = await c.b.request("GET", `/v1/subjects/${c.subject.id}/attendance?cursor=lixo`);
    expect(bad.statusCode).toBe(422);
    expect(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/attendance?limit=500`)).statusCode,
    ).toBe(422);
  });
});

describe("calendário da matéria", () => {
  const calendar = async (c: Ctx, month?: string) => {
    const res = await c.b.request(
      "GET",
      `/v1/subjects/${c.subject.id}/calendar${month ? `?month=${month}` : ""}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    // Dados do aluno nunca ficam em cache de navegador ou proxy.
    expect(res.headers["cache-control"]).toBe("no-store");
    return subjectCalendarSchema.parse(res.json());
  };

  it("mostra os dias de aula do mês de hoje, com o registro, feriado e aula extra", async () => {
    const c = await setup();
    await c.b.request("POST", `/v1/semesters/${c.semesterId}/exceptions`, {
      startsOn: "2026-11-02",
      endsOn: "2026-11-02",
      kind: "holiday",
      label: "Finados",
    });
    const marked = await registered(c, {
      classDate: MONDAY,
      scheduleId: c.mon.id,
      status: "present",
    });
    const extra = await registered(c, { classDate: "2026-11-07", status: "absent" }); // sábado

    const cal = await calendar(c);
    expect(cal).toMatchObject({
      month: "2026-11",
      today: TODAY,
      semester: { startsOn: "2026-08-03", endsOn: "2026-12-18" },
      prevMonth: "2026-10",
      nextMonth: "2026-12",
    });
    // Segundas (2, 9, 16, 23, 30) e quartas (4, 11, 18, 25) + a aula extra do sábado 7.
    expect(cal.days.map((d) => d.date)).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-07",
      "2026-11-09",
      "2026-11-11",
      "2026-11-16",
      "2026-11-18",
      "2026-11-23",
      "2026-11-25",
      "2026-11-30",
    ]);
    const day = (date: string) => cal.days.find((d) => d.date === date)!.classes;
    expect(day("2026-11-02")[0]!.blocked).toEqual({ kind: "holiday", label: "Finados" });
    expect(day(MONDAY)).toEqual([
      expect.objectContaining({
        scheduleId: c.mon.id,
        startsAt: "19:00",
        endsAt: "20:40",
        units: 2,
        record: expect.objectContaining({ id: marked.record.id, status: "present" }),
      }),
    ]);
    expect(day("2026-11-07")).toEqual([
      expect.objectContaining({
        scheduleId: null,
        record: expect.objectContaining({ id: extra.record.id }),
      }),
    ]);
    expect(day(TODAY)[0]!.record).toBeNull();
    expect(cal.summary).toMatchObject({ absentUnits: 2 });
  });

  it("respeita o início e o fim do semestre", async () => {
    const c = await setup();
    const august = await calendar(c, "2026-08");
    expect(august.prevMonth).toBeNull();
    expect(august.days[0]!.date).toBe("2026-08-03");
    const december = await calendar(c, "2026-12");
    expect(december.nextMonth).toBeNull();
    expect(december.days.map((d) => d.date)).toEqual([
      "2026-12-02",
      "2026-12-07",
      "2026-12-09",
      "2026-12-14",
      "2026-12-16",
    ]);
    expect((await calendar(c, "2027-03")).days).toEqual([]);
  });

  it("recusa mês inválido e matéria de outra pessoa", async () => {
    const c = await setup();
    const bad = await c.b.request("GET", `/v1/subjects/${c.subject.id}/calendar?month=2026-13`);
    expect(bad.statusCode).toBe(422);
    const other = await setup();
    const res = await other.b.request("GET", `/v1/subjects/${c.subject.id}/calendar`);
    expect(res.statusCode).toBe(404);
  });
});

describe("Posso faltar?", () => {
  it("sem faltas: dá para faltar todas as 9 aulas que restam, exatamente no limite", async () => {
    const c = await setup();
    const sim = simulateResponseSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/simulate`)).json(),
    );
    expect(sim.asOf).toBe(TODAY);
    expect(sim.nextClass).toEqual({ date: TODAY, units: 2, scheduleId: c.wed.id });
    expect(sim.ifSkipNext).toMatchObject({
      absentUnits: 2,
      remainingUnits: 16,
      remainingClasses: 8,
      risk: "safe",
      projectedPresencePct: 97.2, // (72 − 2) ÷ 72, truncado
      allowed: true,
    });
    // Segundas e quartas de 18/11 a 16/12: 4 + 5 = 9 aulas × 2 tempos = 18 = o saldo todo.
    expect(sim.upcomingClasses).toBe(9);
    expect(sim.plan).toEqual({ classes: 9, units: 18, untilDate: "2026-12-16", firstUnsafe: null });
  });

  it("perto do limite: só cabem 2 aulas e a terceira já reprova", async () => {
    const c = await setup();
    for (let day = 1; day <= 7; day++) await registered(c, { classDate: `2026-09-0${day}` }); // 7 × 2 = 14 tempos
    const sim = simulateResponseSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/simulate`)).json(),
    );
    expect(sim.summary).toMatchObject({ absentUnits: 14, remainingUnits: 4 });
    expect(sim.ifSkipNext).toMatchObject({
      absentUnits: 16,
      remainingUnits: 2,
      risk: "critical",
      allowed: true,
    });
    expect(sim.plan).toEqual({
      classes: 2,
      units: 4,
      untilDate: "2026-11-23",
      firstUnsafe: { date: "2026-11-25", units: 2 },
    });
  });

  it("no limite exato: a próxima falta reprova", async () => {
    const c = await setup();
    for (let day = 1; day <= 9; day++) await registered(c, { classDate: `2026-09-0${day}` }); // 18 tempos
    const sim = simulateResponseSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/simulate`)).json(),
    );
    expect(sim.summary).toMatchObject({ risk: "limit", remainingUnits: 0 });
    expect(sim.ifSkipNext).toMatchObject({ remainingUnits: -2, risk: "failed", allowed: false });
    expect(sim.plan).toMatchObject({
      classes: 0,
      units: 0,
      untilDate: null,
      firstUnsafe: { date: TODAY },
    });
  });

  it("feriados saem da conta e a aula de hoje já registrada não conta como futura", async () => {
    const c = await setup();
    await c.b.request("POST", `/v1/semesters/${c.semesterId}/exceptions`, {
      startsOn: "2026-11-23",
      endsOn: "2026-11-23",
      kind: "holiday",
      label: "Feriado",
    });
    await registered(c, { classDate: TODAY, scheduleId: c.wed.id }); // hoje já registrado
    const sim = simulateResponseSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/simulate`)).json(),
    );
    expect(sim.nextClass?.date).toBe("2026-11-25"); // pulou hoje (registrado) e segunda (feriado)
    expect(sim.upcomingClasses).toBe(7); // 9 − hoje − feriado
    expect(sim.summary.absentUnits).toBe(2);
  });

  it("semestre sem grade ou já terminado: sem próxima aula, sem simulação", async () => {
    const c = await setup({ schedules: [] });
    const sim = simulateResponseSchema.parse(
      (await c.b.request("GET", `/v1/subjects/${c.subject.id}/simulate`)).json(),
    );
    expect(sim).toMatchObject({
      nextClass: null,
      ifSkipNext: null,
      upcomingClasses: 0,
      plan: { classes: 0, units: 0 },
    });
  });
});

describe("isolamento entre alunos", () => {
  it("o que é de outra pessoa é 404, em todas as rotas", async () => {
    const alice = await setup();
    const bob = await setup();
    const { record } = await registered(alice, { classDate: TODAY, scheduleId: alice.wed.id });

    expect(
      (
        await bob.b.request(
          "PATCH",
          `/v1/attendance/${record.id}`,
          { status: "present" },
          { headers: ifMatch(1) },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await bob.b.request("DELETE", `/v1/attendance/${record.id}`, undefined, {
          headers: ifMatch(1),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await bob.b.request("GET", `/v1/subjects/${alice.subject.id}/attendance`)).statusCode,
    ).toBe(404);
    expect(
      (await bob.b.request("GET", `/v1/subjects/${alice.subject.id}/simulate`)).statusCode,
    ).toBe(404);
    const intruder = await bob.b.request(
      "POST",
      "/v1/attendance",
      { subjectId: alice.subject.id, classDate: TODAY, status: "absent" },
      { headers: key() },
    );
    expect(intruder.statusCode).toBe(404);
    // Em "hoje", o Bob só vê a própria matéria; nada da Alice aparece, nem o registro dela.
    const bobToday = todayResponseSchema.parse((await bob.b.request("GET", "/v1/today")).json());
    expect(bobToday.classes.map((x) => x.subject.id)).toEqual([bob.subject.id]);
    expect(bobToday.classes[0]!.record).toBeNull();
    // E a Alice continua com o registro intacto.
    expect(await countLogs(alice.subject.id)).toBe(1);
  });
});
