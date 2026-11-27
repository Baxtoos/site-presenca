import { randomUUID } from "node:crypto";
import {
  gradesOverviewSchema,
  meResponseSchema,
  notificationListSchema,
  problemSchema,
  type SuapSnapshot,
  subjectGradingSchema,
  suapSyncResultSchema,
  subjectsResponseSchema,
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

let seq = 0;
const key = () => ({ "idempotency-key": randomUUID() });

async function student() {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `suap.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-do-suap-teste-1",
    fullName: "Aluna SUAP",
  });
  expect(reg.statusCode).toBe(200);
  return { b, userId: meResponseSchema.parse(reg.json()).id };
}
type Student = Awaited<ReturnType<typeof student>>;

const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

const lesson = (date: string, units: number, absences = 0, excused = false) => ({
  date,
  units,
  absences,
  excused,
  content: absences > 0 ? "Metodologias Ágeis XP, Scrum, Kanban" : "",
});

function snapshot(): SuapSnapshot {
  return {
    format: "suap",
    version: 1,
    host: "suap.ifsp.edu.br",
    period: "2026_2",
    subjects: [
      {
        diario: "397554",
        code: "SLTESO1",
        name: "ENGENHARIA DE SOFTWARE 1",
        plannedUnits: 76,
        deliveredUnits: 16,
        absences: 4,
        frequencyPct: 75,
        professor: "EDSON MURAKAMI",
        location: "D107 - Laboratório de Informática - Prédio Câmpus Salto (SLT)",
        slots: [
          { weekday: 2, startsAt: "08:50", endsAt: "09:40" },
          { weekday: 2, startsAt: "09:40", endsAt: "10:30" },
          { weekday: 2, startsAt: "10:40", endsAt: "11:30" },
          { weekday: 2, startsAt: "11:30", endsAt: "12:20" },
        ],
        grades: null,
        lessons: [
          lesson("2026-08-04", 4),
          lesson("2026-08-11", 4),
          lesson("2026-08-18", 4, 4),
          lesson("2026-08-25", 4),
          lesson(FUTURE, 4),
        ],
      },
      {
        diario: "397727",
        code: "SLTBDO2",
        name: "BANCOS DE DADOS 2",
        plannedUnits: 80,
        deliveredUnits: 8,
        absences: 2,
        frequencyPct: 75,
        professor: null,
        location: null,
        slots: [],
        grades: null,
        lessons: [lesson("2026-08-06", 4, 2), lesson("2026-08-13", 4, 4, true)],
      },
    ],
  };
}

const sync = (s: Student, body: object, headers = key()) =>
  s.b.request("POST", "/v1/imports/suap", body, { headers });

const subjectsOf = async (s: Student, semesterId: string) =>
  subjectsResponseSchema
    .parse((await s.b.request("GET", `/v1/semesters/${semesterId}/subjects`)).json())
    .subjects.sort((a, b) => a.name.localeCompare(b.name));

const unread = async (s: Student) =>
  notificationListSchema.parse((await s.b.request("GET", "/v1/notifications")).json()).unreadCount;

describe("Sincronizar com o SUAP (POST /v1/imports/suap)", () => {
  it("cria o semestre com matérias, regras, grade e faltas; aulas futuras ficam de fora", async () => {
    const ana = await student();
    const before = await unread(ana);
    const res = await sync(ana, { semesterId: null, snapshot: snapshot() });
    expect(res.statusCode, res.body).toBe(200);
    const result = suapSyncResultSchema.parse(res.json());
    expect(result).toMatchObject({
      label: "2026.2",
      createdSemester: true,
      subjectsCreated: 2,
      created: 6,
      updated: 0,
      unchanged: 0,
      future: 1,
    });

    const [bd2, eso1] = await subjectsOf(ana, result.semesterId);
    expect(eso1).toMatchObject({
      name: "Engenharia de Software 1",
      code: "SLTESO1",
      professor: "Edson Murakami",
      countingMode: "class_count",
      totalClasses: 19,
      unitsPerClass: 4,
      minAttendanceBp: 7500,
      excusedPolicy: "deduct",
      schedules: [
        expect.objectContaining({
          weekday: 2,
          startsAt: "08:50",
          endsAt: "12:20",
          units: 4,
          room: "D107",
        }),
      ],
    });
    expect(eso1!.summary).toMatchObject({ maxAbsenceUnits: 19, absentUnits: 4 });
    expect(bd2).toMatchObject({ name: "Bancos de Dados 2", totalClasses: 20, schedules: [] });
    expect(bd2!.summary).toMatchObject({ absentUnits: 2, excusedUnits: 4 });

    const sem = (await ana.b.request("GET", `/v1/semesters/${result.semesterId}`)).json<{
      startsOn: string;
      endsOn: string;
    }>();
    expect(sem).toMatchObject({
      startsOn: "2026-08-04",
      endsOn: FUTURE > "2026-12-18" ? FUTURE : "2026-12-18",
    });
    expect(await unread(ana)).toBe(before);
  });

  it("atualiza o mesmo semestre: o SUAP corrige as aulas lançadas e o resto fica", async () => {
    const ana = await student();
    const first = suapSyncResultSchema.parse(
      (await sync(ana, { semesterId: null, snapshot: snapshot() })).json(),
    );
    const [, eso1] = await subjectsOf(ana, first.semesterId);

    const history = (await ana.b.request("GET", `/v1/subjects/${eso1!.id}/attendance`)).json<{
      records: { id: string; classDate: string; version: number }[];
    }>().records;
    const aug25 = history.find((h) => h.classDate === "2026-08-25")!;
    const marked = await ana.b.request(
      "PATCH",
      `/v1/attendance/${aug25.id}`,
      { status: "absent" },
      { headers: { "if-match": `"${aug25.version}"` } },
    );
    expect(marked.statusCode, marked.body).toBe(200);
    const own = await ana.b.request(
      "POST",
      "/v1/attendance",
      {
        subjectId: eso1!.id,
        scheduleId: eso1!.schedules[0]!.id,
        classDate: "2026-09-01",
        status: "absent",
      },
      { headers: key() },
    );
    expect(own.statusCode, own.body).toBe(201);

    const next = snapshot();
    next.subjects[0]!.lessons.push(lesson("2026-09-08", 4, 4));
    const headers = key();
    const res = await sync(ana, { semesterId: first.semesterId, snapshot: next }, headers);
    expect(res.statusCode, res.body).toBe(200);
    expect(suapSyncResultSchema.parse(res.json())).toMatchObject({
      semesterId: first.semesterId,
      createdSemester: false,
      subjectsCreated: 0,
      created: 1,
      updated: 1,
      unchanged: 5,
    });
    const [, after] = await subjectsOf(ana, first.semesterId);
    expect(after!.summary.absentUnits).toBe(12);

    const again = await sync(ana, { semesterId: first.semesterId, snapshot: next }, headers);
    expect(again.headers["idempotent-replayed"]).toBe("true");

    const third = suapSyncResultSchema.parse(
      (await sync(ana, { semesterId: first.semesterId, snapshot: next })).json(),
    );
    expect(third).toMatchObject({ created: 0, updated: 0, unchanged: 7 });
  });

  it("semestre de outra pessoa ou inexistente é 404; dados fora do formato são 422", async () => {
    const ana = await student();
    const bia = await student();
    const mine = suapSyncResultSchema.parse(
      (await sync(ana, { semesterId: null, snapshot: snapshot() })).json(),
    );
    const other = await sync(bia, { semesterId: mine.semesterId, snapshot: snapshot() });
    expect(other.statusCode).toBe(404);
    expect(problemSchema.parse(other.json()).detail).toMatch(/não encontrado/);
    expect((await sync(bia, { semesterId: randomUUID(), snapshot: snapshot() })).statusCode).toBe(
      404,
    );
    const bad = snapshot() as unknown as { subjects: { lessons: { units: number }[] }[] };
    bad.subjects[0]!.lessons[0]!.units = 0;
    expect((await sync(bia, { semesterId: null, snapshot: bad })).statusCode).toBe(422);
  });

  it("notas do boletim: guarda na matéria; avisa nota nova só a partir da segunda vez", async () => {
    const ana = await student();
    const withGrades = (etapa: number | null, media: number | null) => {
      const s = snapshot();
      s.subjects[0]!.grades = {
        stages: [{ label: "Etapa 1", score: etapa }],
        average: media,
        finalExam: null,
        finalGrade: null,
        concept: null,
        status: "Cursando",
        assessments: [],
      };
      return s;
    };
    const first = suapSyncResultSchema.parse(
      (await sync(ana, { semesterId: null, snapshot: withGrades(7.5, null) })).json(),
    );
    const subject = (await subjectsOf(ana, first.semesterId)).find(
      (s) => s.code === snapshot().subjects[0]!.code,
    )!;
    const grading = subjectGradingSchema.parse(
      (await ana.b.request("GET", `/v1/subjects/${subject.id}/grading`)).json(),
    );
    expect(grading.official).toMatchObject({
      stages: [{ label: "Etapa 1", score: 7.5 }],
      average: null,
      status: "Cursando",
    });
    const grades = async () =>
      (
        await env.db.admin.query<{ payload: { itemName: string; score: number; source: string } }>(
          "select payload from app.notification_logs where user_id = $1 and kind = 'grade_posted' and channel = 'in_app'",
          [ana.userId],
        )
      ).rows.map((r) => r.payload);
    expect(await grades()).toEqual([]);

    await sync(ana, { semesterId: first.semesterId, snapshot: withGrades(7.5, 8) });
    await sync(ana, { semesterId: first.semesterId, snapshot: withGrades(7.5, 8) });
    expect(await grades()).toEqual([
      { subjectName: subject.name, itemName: "Média", score: 800, maxScore: 1000, source: "suap" },
    ]);

    await sync(ana, { semesterId: first.semesterId, snapshot: snapshot() });
    const kept = subjectGradingSchema.parse(
      (await ana.b.request("GET", `/v1/subjects/${subject.id}/grading`)).json(),
    );
    expect(kept.official?.average).toBe(8);
    const overview = gradesOverviewSchema.parse((await ana.b.request("GET", "/v1/grades")).json());
    expect(overview.subjects.find((s) => s.subjectId === subject.id)?.official?.average).toBe(8);
  });

  it("avaliações do Detalhar: a nota vai para a avaliação com a mesma sigla, sem passar por cima do aluno", async () => {
    const bia = await student();
    const detailed = (a1: number | null, a2: number | null) => {
      const s = snapshot();
      s.subjects[0]!.grades = {
        stages: [{ label: "Etapa 1", score: null }],
        average: null,
        finalExam: null,
        finalGrade: null,
        concept: null,
        status: "Cursando",
        assessments: [
          {
            stage: "Etapa 1",
            method: "Média Aritmética",
            code: "A1",
            kind: "Prova",
            description: "A1",
            date: null,
            weight: null,
            score: a1,
          },
          {
            stage: "Etapa 1",
            method: "Média Aritmética",
            code: "A2",
            kind: "Trabalho",
            description: null,
            date: null,
            weight: null,
            score: a2,
          },
          {
            stage: "Etapa Final",
            method: "Média Aritmética",
            code: "A1",
            kind: "Prova",
            description: null,
            date: null,
            weight: null,
            score: null,
          },
        ],
      };
      return s;
    };
    const first = suapSyncResultSchema.parse(
      (await sync(bia, { semesterId: null, snapshot: detailed(9.1, null) })).json(),
    );
    const subject = (await subjectsOf(bia, first.semesterId)).find(
      (s) => s.code === snapshot().subjects[0]!.code,
    )!;
    const saved = subjectGradingSchema.parse(
      (
        await bia.b.request("PUT", `/v1/subjects/${subject.id}/grading`, {
          rules: { scale: 10, passing: 600, formula: "(A1 + A2) / 2" },
          items: [
            { key: "A1", name: "Prova A1", maxScore: 1000 },
            { key: "A2", name: "Trabalho A2", maxScore: 1000 },
          ],
          source: "manual",
        })
      ).json(),
    );
    expect(saved.official?.assessments.map((a) => [a.stage, a.code, a.score])).toEqual([
      ["Etapa 1", "A1", 9.1],
      ["Etapa 1", "A2", null],
      ["Etapa Final", "A1", null],
    ]);
    expect(saved.items.map((i) => [i.key, i.score, i.scoreSource])).toEqual([
      ["A1", 910, "suap"],
      ["A2", null, "user"],
    ]);

    const a2 = saved.items.find((i) => i.key === "A2")!;
    await bia.b.request(
      "PATCH",
      `/v1/evaluation-items/${a2.id}`,
      { score: 500 },
      { headers: { "if-match": `"${a2.version}"` } },
    );
    await sync(bia, { semesterId: first.semesterId, snapshot: detailed(9.5, 8) });
    const after = subjectGradingSchema.parse(
      (await bia.b.request("GET", `/v1/subjects/${subject.id}/grading`)).json(),
    );
    expect(after.items.map((i) => [i.key, i.score, i.scoreSource])).toEqual([
      ["A1", 950, "suap"],
      ["A2", 500, "user"],
    ]);
    const notices = await env.db.admin.query<{ payload: { itemName: string; score: number } }>(
      "select payload from app.notification_logs where user_id = $1 and kind = 'grade_posted' and channel = 'in_app' order by created_at",
      [bia.userId],
    );
    expect(notices.rows.map((r) => [r.payload.itemName, r.payload.score])).toEqual([
      ["A1 (Etapa 1)", 950],
      ["A2 (Etapa 1)", 800],
    ]);
  });
});
