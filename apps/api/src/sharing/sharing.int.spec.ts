import { randomUUID } from "node:crypto";
import {
  importTemplateResultSchema,
  meResponseSchema,
  problemSchema,
  sharedTemplateSchema,
  sharedTemplatesResponseSchema,
  subjectGradingSchema,
  subjectSchema,
  subjectsResponseSchema,
  templatePreviewSchema,
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
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());

async function student(opts: { verified?: boolean; name?: string } = {}) {
  const b = new Browser(env.app);
  const email = `share.${Date.now()}.${++seq}@exemplo.com`;
  const reg = await registerAndConfirm(env, b, {
    email,
    password: "senha-forte-do-compartilhar-1",
    fullName: opts.name ?? "Aluna Compartilha",
  });
  expect(reg.statusCode).toBe(200);
  const userId = meResponseSchema.parse(reg.json()).id;
  if (opts.verified === false) {
    await env.db.admin.query("update app.users set email_verified_at = null where id = $1", [
      userId,
    ]);
  }
  return { b, userId, email };
}
type Student = Awaited<ReturnType<typeof student>>;

async function semesterWithSubjects(s: Student, label = "2026.2") {
  const sem = await s.b.request("POST", "/v1/semesters", {
    label,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    isCurrent: true,
  });
  expect(sem.statusCode, sem.body).toBe(201);
  const semesterId = sem.json<{ id: string }>().id;
  const calc = subjectSchema.parse(
    (
      await s.b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
        name: "Cálculo II",
        professor: "Prof. Andrade",
        color: "blue",
        unitsPerClass: 2,
        countingMode: "workload",
        workloadHours: 60,
        workloadHourMinutes: 60,
        unitMinutes: 50,
        minAttendanceBp: 7500,
        schedules: [
          { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
          { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
        ],
      })
    ).json(),
  );
  const lab = subjectSchema.parse(
    (
      await s.b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
        name: "Laboratório de Física",
        unitsPerClass: 1,
        countingMode: "manual",
        manualMaxUnits: 4,
        schedules: [{ weekday: 5, startsAt: "08:00", endsAt: "09:40", units: 1 }],
      })
    ).json(),
  );
  await s.b.request("POST", `/v1/semesters/${semesterId}/exceptions`, {
    startsOn: "2026-11-02",
    endsOn: "2026-11-02",
    kind: "holiday",
    label: "Finados",
  });
  await s.b.request("POST", `/v1/semesters/${semesterId}/exceptions`, {
    startsOn: "2026-10-09",
    endsOn: "2026-10-09",
    kind: "no_classes",
    label: "Lab fechado",
    subjectId: lab.id,
  });
  const absent = await s.b.request(
    "POST",
    "/v1/attendance",
    {
      subjectId: calc.id,
      classDate: "2026-09-14",
      scheduleId: calc.schedules[0]!.id,
      status: "absent",
      note: "nota pessoal secreta",
    },
    { headers: key() },
  );
  expect(absent.statusCode, absent.body).toBe(201);
  return { semesterId, calc, lab };
}

async function share(s: Student, body: Record<string, unknown>) {
  const res = await s.b.request("POST", "/v1/templates", body);
  expect(res.statusCode, res.body).toBe(201);
  return sharedTemplateSchema.parse(res.json());
}

const anon = () => new Browser(env.app);
const preview = async (code: string, b = anon()) => b.request("GET", `/v1/templates/${code}`);
const importIt = (s: Student, code: string, body: Record<string, unknown> = {}, headers = key()) =>
  s.b.request("POST", `/v1/templates/${code}/import`, body, { headers });

describe("criar código", () => {
  it("exige e-mail confirmado", async () => {
    const s = await student({ verified: false });
    const { semesterId } = await semesterWithSubjects(s);
    const res = await s.b.request("POST", "/v1/templates", {
      source: { kind: "semester", semesterId },
    });
    expect(res.statusCode).toBe(403);
    expect(problem(res).code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("gera código Crockford de 8 caracteres, ativo por 30 dias por padrão", async () => {
    const s = await student();
    const { semesterId } = await semesterWithSubjects(s);
    const t = await share(s, { source: { kind: "semester", semesterId }, institution: "UFX" });
    expect(t.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(t).toMatchObject({
      kind: "semester",
      title: "2026.2",
      institution: "UFX",
      status: "active",
      usesCount: 0,
      maxUses: null,
    });
    const days = (new Date(t.expiresAt!).getTime() - env.clock.now().getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("semestre sem matérias não pode ser compartilhado", async () => {
    const s = await student();
    const sem = await s.b.request("POST", "/v1/semesters", {
      label: "Vazio",
      startsOn: "2026-08-03",
      endsOn: "2026-12-18",
    });
    const res = await s.b.request("POST", "/v1/templates", {
      source: { kind: "semester", semesterId: sem.json<{ id: string }>().id },
    });
    expect(res.statusCode).toBe(422);
    expect(problem(res).code).toBe("TEMPLATE_EMPTY");
  });

  it("não compartilha o semestre de outra pessoa", async () => {
    const ana = await student();
    const bia = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const res = await bia.b.request("POST", "/v1/templates", {
      source: { kind: "semester", semesterId },
    });
    expect(res.statusCode).toBe(404);
  });

  it(`no máximo 20 códigos ativos por aluno`, async () => {
    const s = await student();
    const { calc } = await semesterWithSubjects(s);
    for (let i = 0; i < 20; i++)
      await share(s, { source: { kind: "subject", subjectId: calc.id } });
    const res = await s.b.request("POST", "/v1/templates", {
      source: { kind: "subject", subjectId: calc.id },
    });
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe("TEMPLATE_LIMIT");
  });
});

describe("prévia pública", () => {
  it("mostra a estrutura sem login, e nada pessoal (faltas, notas, dono, ids)", async () => {
    const s = await student({ name: "Helena Dona" });
    const { semesterId, calc } = await semesterWithSubjects(s);
    const t = await share(s, { source: { kind: "semester", semesterId }, course: "Engenharia" });
    const res = await preview(t.code);
    expect(res.statusCode).toBe(200);
    const p = templatePreviewSchema.parse(res.json());
    expect(p).toMatchObject({
      code: t.code,
      kind: "semester",
      title: "2026.2",
      course: "Engenharia",
      semester: { label: "2026.2", startsOn: "2026-08-03", endsOn: "2026-12-18" },
    });
    expect(p.subjects.map((x) => [x.name, x.maxAbsenceUnits])).toEqual([
      ["Cálculo II", 18],
      ["Laboratório de Física", 4],
    ]);
    expect(p.subjects[0]!.schedules).toEqual([
      { weekday: 1, startsAt: "19:00", endsAt: "20:40", room: "B-204" },
      { weekday: 3, startsAt: "19:00", endsAt: "20:40", room: "B-204" },
    ]);
    expect(p.exceptions.map((e) => e.label).sort()).toEqual(["Finados", "Lab fechado"]);

    const raw = res.body;
    for (const secret of [
      "nota pessoal secreta",
      "Helena",
      s.email,
      s.userId,
      calc.id,
      semesterId,
      "absent",
    ]) {
      expect(raw).not.toContain(secret);
    }
    const stored = await env.db.admin.query(
      "select payload::text as p from app.shared_templates where id = $1",
      [t.id],
    );
    expect(stored.rows[0].p).not.toContain("nota pessoal secreta");
    expect(stored.rows[0].p).not.toContain("absent");
  });

  it("aceita o código digitado do jeito que a pessoa digitar (minúsculas, hífen, O/0, I/1)", async () => {
    const s = await student();
    const { semesterId } = await semesterWithSubjects(s);
    const t = await share(s, { source: { kind: "semester", semesterId } });
    const typed = `${t.code.slice(0, 4)}-${t.code.slice(4)}`
      .toLowerCase()
      .replace(/0/g, "o")
      .replace(/1/g, "l");
    expect((await preview(encodeURIComponent(typed))).statusCode).toBe(200);
    expect((await preview("ABC")).statusCode).toBe(422);
  });

  it("código inexistente, revogado ou expirado: a mesma resposta (404)", async () => {
    const s = await student();
    const { semesterId } = await semesterWithSubjects(s);
    const revoked = await share(s, { source: { kind: "semester", semesterId } });
    const expired = await share(s, { source: { kind: "semester", semesterId } });
    expect((await s.b.request("DELETE", `/v1/templates/${revoked.id}`)).statusCode).toBe(204);
    await env.db.admin.query(
      "update app.shared_templates set expires_at = now() - interval '1 minute' where id = $1",
      [expired.id],
    );
    const bodies = [];
    for (const code of ["ZZZZZZZZ", revoked.code, expired.code]) {
      const res = await preview(code);
      expect(res.statusCode).toBe(404);
      bodies.push(problem(res).code);
    }
    expect(new Set(bodies)).toEqual(new Set(["TEMPLATE_NOT_FOUND"]));
  });

  it("limite de consultas por IP", async () => {
    const b = anon();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await preview("ZZZZZZZZ", b)).statusCode;
    expect(last).toBe(429);
  });
});

describe("importar", () => {
  it("cria o semestre com as mesmas matérias, regras, grade e feriados — e nenhuma falta", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId } });

    const bia = await student();
    const res = await importIt(bia, t.code);
    expect(res.statusCode, res.body).toBe(201);
    const result = importTemplateResultSchema.parse(res.json());
    expect(result).toMatchObject({ createdSemester: true });
    expect(result.subjectIds).toHaveLength(2);

    const sem = (await bia.b.request("GET", `/v1/semesters/${result.semesterId}`)).json<{
      label: string;
      isCurrent: boolean;
    }>();
    expect(sem).toMatchObject({ label: "2026.2", isCurrent: true });
    const subs = subjectsResponseSchema.parse(
      (await bia.b.request("GET", `/v1/semesters/${result.semesterId}/subjects`)).json(),
    ).subjects;
    const calc = subs.find((x) => x.name === "Cálculo II")!;
    expect(calc).toMatchObject({
      professor: "Prof. Andrade",
      color: "blue",
      countingMode: "workload",
      workloadHours: 60,
      unitMinutes: 50,
      unitsPerClass: 2,
      summary: { absentUnits: 0, maxAbsenceUnits: 18 },
    });
    expect(calc.schedules.map((x) => [x.weekday, x.startsAt, x.room])).toEqual([
      [1, "19:00", "B-204"],
      [3, "19:00", "B-204"],
    ]);
    const records = await env.db.admin.query(
      "select count(*)::int as n from app.attendance_logs where user_id = $1",
      [bia.userId],
    );
    expect(records.rows[0]).toEqual({ n: 0 });

    const lab = subs.find((x) => x.name === "Laboratório de Física")!;
    const ex = await env.db.admin.query(
      "select label, subject_id from app.calendar_exceptions where semester_id = $1 order by label",
      [result.semesterId],
    );
    expect(ex.rows).toEqual([
      { label: "Finados", subject_id: null },
      { label: "Lab fechado", subject_id: lab.id },
    ]);

    const mine = sharedTemplatesResponseSchema.parse(
      (await ana.b.request("GET", "/v1/templates")).json(),
    );
    expect(mine.templates.find((x) => x.id === t.id)!.usesCount).toBe(1);
    const imports = await env.db.admin.query(
      "select created_semester_id from app.template_imports where template_id = $1 and user_id = $2",
      [t.id, bia.userId],
    );
    expect(imports.rows).toEqual([{ created_semester_id: result.semesterId }]);
    const origin = await env.db.admin.query(
      "select distinct source_template_id from app.subjects where semester_id = $1",
      [result.semesterId],
    );
    expect(origin.rows).toEqual([{ source_template_id: t.id }]);
  });

  it("nome repetido ganha sufixo; com semestre atual, o importado não toma o lugar", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId } });
    const bia = await student();
    await bia.b.request("POST", "/v1/semesters", {
      label: "2026.2",
      startsOn: "2026-08-03",
      endsOn: "2026-12-18",
      isCurrent: true,
    });
    const result = importTemplateResultSchema.parse((await importIt(bia, t.code)).json());
    const sem = (await bia.b.request("GET", `/v1/semesters/${result.semesterId}`)).json<{
      label: string;
      isCurrent: boolean;
    }>();
    expect(sem).toMatchObject({ label: "2026.2 (2)", isCurrent: false });
  });

  it("limite de usos vale mesmo com várias importações simultâneas", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId }, maxUses: 2 });
    const others = await Promise.all([1, 2, 3, 4, 5].map(() => student()));
    const results = await Promise.all(others.map((o) => importIt(o, t.code)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 201, 404, 404, 404]);
    const row = await env.db.admin.query(
      "select uses_count from app.shared_templates where id = $1",
      [t.id],
    );
    expect(row.rows[0]).toEqual({ uses_count: 2 });
    expect((await preview(t.code)).statusCode).toBe(404);
  });

  it("repetir a importação (mesma Idempotency-Key) não cria outro semestre nem gasta outro uso", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId } });
    const bia = await student();
    const headers = key();
    const first = await importIt(bia, t.code, {}, headers);
    const again = await importIt(bia, t.code, {}, headers);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    const count = await env.db.admin.query(
      "select count(*)::int as n from app.semesters where user_id = $1",
      [bia.userId],
    );
    expect(count.rows[0]).toEqual({ n: 1 });
    const uses = await env.db.admin.query(
      "select uses_count from app.shared_templates where id = $1",
      [t.id],
    );
    expect(uses.rows[0]).toEqual({ uses_count: 1 });
  });

  it("revogar impede novas importações, mas quem já importou continua com a cópia", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId } });
    const bia = await student();
    const result = importTemplateResultSchema.parse((await importIt(bia, t.code)).json());
    expect((await ana.b.request("DELETE", `/v1/templates/${t.id}`)).statusCode).toBe(204);
    expect((await ana.b.request("DELETE", `/v1/templates/${t.id}`)).statusCode).toBe(204);
    const cris = await student();
    expect((await importIt(cris, t.code)).statusCode).toBe(404);
    expect((await bia.b.request("GET", `/v1/semesters/${result.semesterId}`)).statusCode).toBe(200);
    const mine = sharedTemplatesResponseSchema.parse(
      (await ana.b.request("GET", "/v1/templates")).json(),
    );
    expect(mine.templates.find((x) => x.id === t.id)!.status).toBe("revoked");
  });

  it("modelo de matéria: pede o semestre de destino; só aceita semestre próprio; erro não gasta uso", async () => {
    const ana = await student();
    const { lab } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "subject", subjectId: lab.id } });
    expect(t).toMatchObject({ kind: "subject", title: "Laboratório de Física" });

    const bia = await student();
    const noTarget = await importIt(bia, t.code);
    expect(noTarget.statusCode).toBe(422);
    expect(problem(noTarget).code).toBe("TEMPLATE_SEMESTER_REQUIRED");
    const others = await importIt(bia, t.code, {
      semesterId: (await semesterWithSubjects(ana, "Outro")).semesterId,
    });
    expect(others.statusCode).toBe(404);
    const uses = await env.db.admin.query(
      "select uses_count from app.shared_templates where id = $1",
      [t.id],
    );
    expect(uses.rows[0]).toEqual({ uses_count: 0 });

    const mine = await bia.b.request("POST", "/v1/semesters", {
      label: "Meu",
      startsOn: "2026-08-03",
      endsOn: "2026-12-18",
    });
    const target = mine.json<{ id: string }>().id;
    const res = await importIt(bia, t.code, { semesterId: target });
    expect(res.statusCode, res.body).toBe(201);
    const result = importTemplateResultSchema.parse(res.json());
    expect(result).toMatchObject({ semesterId: target, createdSemester: false });
    const sub = subjectSchema.parse(
      (await bia.b.request("GET", `/v1/subjects/${result.subjectIds[0]}`)).json(),
    );
    expect(sub).toMatchObject({
      name: "Laboratório de Física",
      countingMode: "manual",
      manualMaxUnits: 4,
    });
  });

  it("regra de notas vai junto (versão 2) sem as notas; modelo antigo (versão 1) continua importando", async () => {
    const ana = await student();
    const { semesterId, calc } = await semesterWithSubjects(ana);
    const saved = subjectGradingSchema.parse(
      (
        await ana.b.request("PUT", `/v1/subjects/${calc.id}/grading`, {
          rules: { scale: 10, passing: 600, formula: "0.4*P1 + 0.6*P2" },
          items: [
            { key: "P1", name: "Prova 1", maxScore: 1000, dueOn: "2026-10-01", createTask: true },
            { key: "P2", name: "Prova 2", maxScore: 1000 },
          ],
          source: "ai",
        })
      ).json(),
    );
    const p1 = saved.items[0]!;
    await ana.b.request(
      "PATCH",
      `/v1/evaluation-items/${p1.id}`,
      { score: 850 },
      { headers: { "if-match": `"${p1.version}"` } },
    );
    const t = await share(ana, { source: { kind: "semester", semesterId } });
    const stored = await env.db.admin.query<{ payload_version: number; payload: unknown }>(
      "select payload_version, payload from app.shared_templates where id = $1",
      [t.id],
    );
    expect(stored.rows[0]!.payload_version).toBe(2);
    const raw = JSON.stringify(stored.rows[0]!.payload);
    expect(raw).not.toContain("850");
    expect(raw).not.toContain("2026-10-01");
    const shown = templatePreviewSchema.parse((await preview(t.code)).json());
    expect(shown.subjects.map((s) => [s.name, s.hasGrading])).toEqual([
      ["Cálculo II", true],
      ["Laboratório de Física", false],
    ]);

    const bia = await student();
    const imported = importTemplateResultSchema.parse((await importIt(bia, t.code)).json());
    const subjects = subjectsResponseSchema.parse(
      (await bia.b.request("GET", `/v1/semesters/${imported.semesterId}/subjects`)).json(),
    ).subjects;
    const biaCalc = subjects.find((s) => s.name === "Cálculo II")!;
    const copy = subjectGradingSchema.parse(
      (await bia.b.request("GET", `/v1/subjects/${biaCalc.id}/grading`)).json(),
    );
    expect(copy.scheme).toMatchObject({ source: "manual", rules: { formula: "0.4*P1 + 0.6*P2" } });
    expect(copy.items.map((i) => [i.key, i.score, i.dueOn, i.task])).toEqual([
      ["P1", null, null, null],
      ["P2", null, null, null],
    ]);
    const tasks = await bia.b.request("GET", "/v1/tasks");
    expect(tasks.json<{ tasks: unknown[] }>().tasks).toEqual([]);

    await env.db.admin.query(
      `update app.shared_templates
          set payload_version = 1, payload = payload - 'gradings'
        where id = $1`,
      [t.id],
    );
    const caio = await student();
    const old = await importIt(caio, t.code);
    expect(old.statusCode, old.body).toBe(201);
  });

  it("importar exige login (a prévia não)", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId } });
    const res = await anon().request(
      "POST",
      `/v1/templates/${t.code}/import`,
      {},
      { headers: key() },
    );
    expect(res.statusCode).toBe(401);
  });
});

describe("isolamento", () => {
  it("cada um lista e revoga só os próprios códigos", async () => {
    const ana = await student();
    const bia = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    const t = await share(ana, { source: { kind: "semester", semesterId } });
    const list = sharedTemplatesResponseSchema.parse(
      (await bia.b.request("GET", "/v1/templates")).json(),
    );
    expect(list.templates).toEqual([]);
    expect((await bia.b.request("DELETE", `/v1/templates/${t.id}`)).statusCode).toBe(404);
    expect((await preview(t.code)).statusCode).toBe(200);
  });

  it("a API não lê modelos de ninguém diretamente (só pelas funções do código)", async () => {
    const ana = await student();
    const { semesterId } = await semesterWithSubjects(ana);
    await share(ana, { source: { kind: "semester", semesterId } });
    const direct = await env.db.pools.app_api.query(
      "select count(*)::int as n from app.shared_templates",
    );
    expect(direct.rows[0]).toEqual({ n: 0 });
  });
});
