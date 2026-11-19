import {
  meResponseSchema,
  problemSchema,
  semesterSchema,
  semestersResponseSchema,
  subjectSchema,
  subjectsResponseSchema,
} from "@presenca/contracts";
import { inTx } from "@presenca/db/testing";
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
async function student() {
  const b = new Browser(env.app);
  const res = await registerAndConfirm(env, b, {
    email: `academico.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-academica-1",
    fullName: "Aluna Teste",
  });
  expect(res.statusCode).toBe(200);
  return { b, userId: meResponseSchema.parse(res.json()).id };
}

const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());

async function createSemester(b: Browser, body: Record<string, unknown> = {}) {
  const res = await b.request("POST", "/v1/semesters", {
    label: `2026.${++seq}`,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    ...body,
  });
  expect(res.statusCode).toBe(201);
  return semesterSchema.parse(res.json());
}

const CALCULO = {
  name: "Cálculo II",
  professor: "Prof. Andrade",
  unitsPerClass: 2,
  countingMode: "workload",
  workloadHours: 60,
  workloadHourMinutes: 60,
  unitMinutes: 50,
  minAttendanceBp: 7500,
  schedules: [
    { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
    { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
  ],
};

describe("semestres", () => {
  it("cria com ETag, lista o atual primeiro e só um fica como atual", async () => {
    const { b } = await student();
    const res = await b.request("POST", "/v1/semesters", {
      label: "2026.1",
      startsOn: "2026-02-02",
      endsOn: "2026-07-03",
      isCurrent: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    const first = semesterSchema.parse(res.json());

    const second = await createSemester(b, { label: "2026.2", isCurrent: true });
    const list = semestersResponseSchema.parse((await b.request("GET", "/v1/semesters")).json());
    expect(list.semesters.map((s) => [s.label, s.isCurrent])).toEqual([
      ["2026.2", true],
      ["2026.1", false],
    ]);
    expect(list.semesters[0]!.id).toBe(second.id);
    expect(list.semesters[1]!.id).toBe(first.id);
  });

  it("recusa nome repetido e datas invertidas", async () => {
    const { b } = await student();
    await createSemester(b, { label: "2027.1" });
    const dup = await b.request("POST", "/v1/semesters", {
      label: "2027.1",
      startsOn: "2027-02-01",
      endsOn: "2027-07-01",
    });
    expect(dup.statusCode).toBe(409);
    expect(problem(dup).code).toBe("SEMESTER_LABEL_TAKEN");

    const inverted = await b.request("POST", "/v1/semesters", {
      label: "X",
      startsOn: "2027-07-01",
      endsOn: "2027-02-01",
    });
    expect(inverted.statusCode).toBe(422);
    expect(problem(inverted).errors?.[0]?.path).toBe("endsOn");
  });

  it("edição exige If-Match: sem ele 428, com versão velha 412, com a certa 200 e nova versão", async () => {
    const { b } = await student();
    const s = await createSemester(b);

    const missing = await b.request("PATCH", `/v1/semesters/${s.id}`, { label: "Novo" });
    expect(missing.statusCode).toBe(428);
    expect(problem(missing).code).toBe("VERSION_REQUIRED");

    const ok = await b.request(
      "PATCH",
      `/v1/semesters/${s.id}`,
      { label: "Novo nome" },
      { headers: { "if-match": '"1"' } },
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.json()).toMatchObject({ label: "Novo nome", version: 2 });

    // Outro dispositivo ainda com a versão 1 tenta salvar por cima.
    const stale = await b.request(
      "PATCH",
      `/v1/semesters/${s.id}`,
      { label: "Por cima" },
      { headers: { "if-match": '"1"' } },
    );
    expect(stale.statusCode).toBe(412);
    expect(problem(stale).code).toBe("VERSION_MISMATCH");
  });

  it("arquivar tira o 'atual'; marcar como atual desarquiva", async () => {
    const { b } = await student();
    const s = await createSemester(b, { isCurrent: true });
    const archived = await b.request(
      "PATCH",
      `/v1/semesters/${s.id}`,
      { status: "archived" },
      { headers: { "if-match": '"1"' } },
    );
    expect(archived.json()).toMatchObject({ status: "archived", isCurrent: false });
    const back = await b.request(
      "PATCH",
      `/v1/semesters/${s.id}`,
      { isCurrent: true },
      { headers: { "if-match": '"2"' } },
    );
    expect(back.json()).toMatchObject({ status: "active", isCurrent: true });
  });

  it("de outra pessoa é invisível: 404 em ler, editar, apagar e criar matéria nele", async () => {
    const alice = await student();
    const bob = await student();
    const s = await createSemester(alice.b);
    const h = { headers: { "if-match": '"1"' } };
    expect((await bob.b.request("GET", `/v1/semesters/${s.id}`)).statusCode).toBe(404);
    expect(
      (await bob.b.request("PATCH", `/v1/semesters/${s.id}`, { label: "Invadido" }, h)).statusCode,
    ).toBe(404);
    expect((await bob.b.request("DELETE", `/v1/semesters/${s.id}`, undefined, h)).statusCode).toBe(
      404,
    );
    expect(
      (await bob.b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).statusCode,
    ).toBe(404);
    expect((await alice.b.request("GET", `/v1/semesters/${s.id}`)).json()).toMatchObject({
      label: s.label,
      version: 1,
    });
  });
});

describe("matérias", () => {
  it("cria com regras e grade numa transação, com o resumo do motor", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const res = await b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO);
    expect(res.statusCode).toBe(201);
    const subject = subjectSchema.parse(res.json());
    expect(subject).toMatchObject({
      name: "Cálculo II",
      workloadHours: 60,
      totalClasses: null,
      version: 1,
    });
    expect(subject.schedules.map((x) => x.weekday)).toEqual([1, 3]); // segunda antes de quarta
    expect(subject.schedules[0]).toMatchObject({
      startsAt: "19:00",
      endsAt: "20:40",
      units: 2,
      room: "B-204",
    });
    expect(subject.summary).toMatchObject({
      totalUnits: 72,
      maxAbsenceUnits: 18,
      absentUnits: 0,
      remainingUnits: 18,
      remainingClasses: 9,
      risk: "safe",
    });
  });

  it("horário inválido não deixa a matéria pela metade (nada é gravado)", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const res = await b.request("POST", `/v1/semesters/${s.id}/subjects`, {
      ...CALCULO,
      schedules: [{ weekday: 1, startsAt: "20:40", endsAt: "19:00", units: 2 }],
    });
    expect(res.statusCode).toBe(422);
    expect(problem(res).errors?.[0]?.path).toBe("schedules.0.endsAt");
    const list = subjectsResponseSchema.parse(
      (await b.request("GET", `/v1/semesters/${s.id}/subjects`)).json(),
    );
    expect(list.subjects).toEqual([]);
  });

  it("exige os campos do modo de contagem escolhido", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const { unitMinutes: _omit, ...semDuracao } = CALCULO;
    const res = await b.request("POST", `/v1/semesters/${s.id}/subjects`, semDuracao);
    expect(res.statusCode).toBe(422);
    expect(problem(res).errors?.map((e) => e.path)).toContain("unitMinutes");
  });

  it("o resumo acompanha os registros de presença (derivado, nada guardado)", async () => {
    const { b, userId } = await student();
    const s = await createSemester(b);
    const subject = subjectSchema.parse(
      (await b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).json(),
    );

    // A Fase 4 cria as rotas de registro; aqui os registros entram direto pelo banco, como a API faria.
    await inTx(env.db.pools.app_api, { userId }, async (c) => {
      for (const date of [
        "2026-08-03",
        "2026-08-05",
        "2026-08-10",
        "2026-08-12",
        "2026-08-17",
        "2026-08-19",
        "2026-08-24",
      ]) {
        await c.query(
          `insert into attendance_logs (user_id, subject_id, class_date, status, units_scheduled, units_missed)
           values ($1, $2, $3, 'absent', 2, 2)`,
          [userId, subject.id, date],
        );
      }
    });

    const after = subjectSchema.parse(
      (await b.request("GET", `/v1/subjects/${subject.id}`)).json(),
    );
    expect(after.summary).toMatchObject({
      absentUnits: 14,
      heldUnits: 14,
      remainingUnits: 4,
      remainingClasses: 2,
      consumptionPct: 77,
      risk: "critical",
      projectedPresencePct: 80.5,
      presenceSoFarPct: 0,
    });
  });

  it("trocar o modo de contagem limpa os campos do modo antigo e recalcula o limite", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const subject = subjectSchema.parse(
      (await b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).json(),
    );
    const { schedules: _s, ...dados } = CALCULO;
    const res = await b.request(
      "PUT",
      `/v1/subjects/${subject.id}`,
      {
        ...dados,
        countingMode: "class_count",
        totalClasses: 40,
        unitsPerClass: 1,
        minAttendanceBp: 8000,
      },
      { headers: { "if-match": '"1"' } },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      countingMode: "class_count",
      totalClasses: 40,
      workloadHours: null,
      workloadHourMinutes: null,
      unitMinutes: null,
      version: 2,
      summary: { totalUnits: 40, maxAbsenceUnits: 8 },
    });
    // A grade não é tocada pelo PUT da matéria.
    expect(subjectSchema.parse(res.json()).schedules).toHaveLength(2);

    const stale = await b.request(
      "PUT",
      `/v1/subjects/${subject.id}`,
      { ...dados },
      { headers: { "if-match": '"1"' } },
    );
    expect(stale.statusCode).toBe(412);
  });

  it("apagar exige a versão e leva junto a grade", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const subject = subjectSchema.parse(
      (await b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).json(),
    );
    expect((await b.request("DELETE", `/v1/subjects/${subject.id}`)).statusCode).toBe(428);
    expect(
      (
        await b.request("DELETE", `/v1/subjects/${subject.id}`, undefined, {
          headers: { "if-match": '"1"' },
        })
      ).statusCode,
    ).toBe(204);
    expect((await b.request("GET", `/v1/subjects/${subject.id}`)).statusCode).toBe(404);
  });

  it("matéria de outra pessoa é 404", async () => {
    const alice = await student();
    const bob = await student();
    const s = await createSemester(alice.b);
    const subject = subjectSchema.parse(
      (await alice.b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).json(),
    );
    expect((await bob.b.request("GET", `/v1/subjects/${subject.id}`)).statusCode).toBe(404);
    expect(
      (await bob.b.request("POST", `/v1/subjects/${subject.id}/schedules`, CALCULO.schedules[0]))
        .statusCode,
    ).toBe(404);
  });
});

describe("grade semanal", () => {
  it("acrescenta, substitui (com versão) e remove horários", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const subject = subjectSchema.parse(
      (
        await b.request("POST", `/v1/semesters/${s.id}/subjects`, { ...CALCULO, schedules: [] })
      ).json(),
    );

    const created = await b.request("POST", `/v1/subjects/${subject.id}/schedules`, {
      weekday: 5,
      startsAt: "08:00",
      endsAt: "09:40",
      units: 2,
    });
    expect(created.statusCode).toBe(201);
    const scheduleId = created.json<{ id: string }>().id;

    const replaced = await b.request(
      "PUT",
      `/v1/subjects/${subject.id}/schedules/${scheduleId}`,
      { weekday: 5, startsAt: "10:00", endsAt: "11:40", units: 2, room: "Lab 2" },
      { headers: { "if-match": '"1"' } },
    );
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ startsAt: "10:00", room: "Lab 2", version: 2 });

    expect(
      (await b.request("DELETE", `/v1/subjects/${subject.id}/schedules/${scheduleId}`)).statusCode,
    ).toBe(204);
    expect(
      (await b.request("DELETE", `/v1/subjects/${subject.id}/schedules/${scheduleId}`)).statusCode,
    ).toBe(404);
  });

  it("não mexe em horário pela matéria errada", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const a = subjectSchema.parse(
      (await b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).json(),
    );
    const other = subjectSchema.parse(
      (
        await b.request("POST", `/v1/semesters/${s.id}/subjects`, {
          ...CALCULO,
          name: "Física",
          schedules: [],
        })
      ).json(),
    );
    const res = await b.request(
      "DELETE",
      `/v1/subjects/${other.id}/schedules/${a.schedules[0]!.id}`,
    );
    expect(res.statusCode).toBe(404);
  });
});

describe("feriados e exceções", () => {
  it("cadastra dentro do semestre, lista em ordem e remove", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const url = `/v1/semesters/${s.id}/exceptions`;
    expect(
      (
        await b.request("POST", url, {
          startsOn: "2026-11-20",
          endsOn: "2026-11-20",
          kind: "holiday",
          label: "Consciência Negra",
        })
      ).statusCode,
    ).toBe(201);
    const recesso = await b.request("POST", url, {
      startsOn: "2026-10-12",
      endsOn: "2026-10-16",
      kind: "no_classes",
      label: "Semana acadêmica",
    });
    expect(recesso.statusCode).toBe(201);

    const list = (await b.request("GET", url)).json<{ exceptions: { label: string }[] }>();
    expect(list.exceptions.map((e) => e.label)).toEqual(["Semana acadêmica", "Consciência Negra"]);

    const id = recesso.json<{ id: string }>().id;
    expect((await b.request("DELETE", `${url}/${id}`)).statusCode).toBe(204);
  });

  it("recusa datas fora do semestre e matéria de outro semestre", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const other = await createSemester(b, { label: "Outro" });
    const subjectOfOther = subjectSchema.parse(
      (await b.request("POST", `/v1/semesters/${other.id}/subjects`, CALCULO)).json(),
    );

    const outside = await b.request("POST", `/v1/semesters/${s.id}/exceptions`, {
      startsOn: "2026-12-20",
      endsOn: "2026-12-31",
      kind: "no_classes",
      label: "Férias",
    });
    expect(outside.statusCode).toBe(422);
    expect(problem(outside).code).toBe("OUT_OF_SEMESTER");
    // O erro aponta a data que o aluno preencheu (início), com data no formato brasileiro.
    expect(problem(outside).errors).toEqual([
      { path: "startsOn", message: "Fica fora do semestre (03/08/2026 a 18/12/2026)." },
    ]);

    const wrongSubject = await b.request("POST", `/v1/semesters/${s.id}/exceptions`, {
      startsOn: "2026-09-01",
      endsOn: "2026-09-01",
      kind: "holiday",
      label: "Só desta matéria",
      subjectId: subjectOfOther.id,
    });
    expect(problem(wrongSubject).code).toBe("SUBJECT_NOT_IN_SEMESTER");
  });
});

describe("apagar semestre", () => {
  it("leva junto matérias, grade e feriados", async () => {
    const { b } = await student();
    const s = await createSemester(b);
    const subject = subjectSchema.parse(
      (await b.request("POST", `/v1/semesters/${s.id}/subjects`, CALCULO)).json(),
    );
    await b.request("POST", `/v1/semesters/${s.id}/exceptions`, {
      startsOn: "2026-09-07",
      endsOn: "2026-09-07",
      kind: "holiday",
      label: "Independência",
    });
    expect(
      (
        await b.request("DELETE", `/v1/semesters/${s.id}`, undefined, {
          headers: { "if-match": '"1"' },
        })
      ).statusCode,
    ).toBe(204);
    expect((await b.request("GET", `/v1/subjects/${subject.id}`)).statusCode).toBe(404);
  });
});
