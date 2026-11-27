import { randomUUID } from "node:crypto";
import {
  meResponseSchema,
  notificationListSchema,
  problemSchema,
  type SemesterImportBody,
  semesterImportResultSchema,
  SPREADSHEET_DATA_SHEET,
  spreadsheetDataSchema,
  subjectSchema,
  subjectsResponseSchema,
} from "@presenca/contracts";
import ExcelJS from "exceljs";
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

async function student() {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `planilha.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-da-planilha-1",
    fullName: "Aluna Planilha",
  });
  expect(reg.statusCode).toBe(200);
  return { b, userId: meResponseSchema.parse(reg.json()).id };
}
type Student = Awaited<ReturnType<typeof student>>;

const unread = async (s: Student) =>
  notificationListSchema.parse((await s.b.request("GET", "/v1/notifications")).json()).unreadCount;

async function fullSemester(s: Student) {
  const sem = await s.b.request("POST", "/v1/semesters", {
    label: "2026.1",
    startsOn: "2026-03-02",
    endsOn: "2026-07-10",
    isCurrent: true,
  });
  expect(sem.statusCode, sem.body).toBe(201);
  const semesterId = sem.json<{ id: string }>().id;
  const create = async (body: object) =>
    subjectSchema.parse(
      (await s.b.request("POST", `/v1/semesters/${semesterId}/subjects`, body)).json(),
    );
  const calc = await create({
    name: "Cálculo II",
    professor: "Prof. Andrade",
    color: "violet",
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
  });
  const lab = await create({
    name: "Laboratório de Redes",
    unitsPerClass: 2,
    countingMode: "manual",
    manualMaxUnits: 4,
    excusedPolicy: "deduct",
    schedules: [{ weekday: 5, startsAt: "08:00", endsAt: "09:40", units: 2 }],
  });
  const holiday = await s.b.request("POST", `/v1/semesters/${semesterId}/exceptions`, {
    startsOn: "2026-04-21",
    endsOn: "2026-04-21",
    kind: "holiday",
    label: "Tiradentes",
  });
  expect(holiday.statusCode, holiday.body).toBe(201);

  const logs = [
    {
      subjectId: calc.id,
      scheduleId: calc.schedules[0]!.id,
      classDate: "2026-03-02",
      status: "present",
    },
    {
      subjectId: calc.id,
      scheduleId: calc.schedules[1]!.id,
      classDate: "2026-03-04",
      status: "absent",
      reason: "transport",
      note: "Ônibus atrasou",
    },
    {
      subjectId: calc.id,
      scheduleId: calc.schedules[0]!.id,
      classDate: "2026-03-09",
      status: "partial",
      unitsMissed: 1,
    },
    {
      subjectId: calc.id,
      scheduleId: calc.schedules[1]!.id,
      classDate: "2026-03-11",
      status: "cancelled",
    },
    { subjectId: calc.id, classDate: "2026-03-14", status: "absent", unitsScheduled: 3 },
    {
      subjectId: lab.id,
      scheduleId: lab.schedules[0]!.id,
      classDate: "2026-03-06",
      status: "absent",
      isExcused: true,
      reason: "health",
    },
    {
      subjectId: lab.id,
      scheduleId: lab.schedules[0]!.id,
      classDate: "2026-03-13",
      status: "absent",
    },
    {
      subjectId: lab.id,
      scheduleId: lab.schedules[0]!.id,
      classDate: "2026-03-20",
      status: "absent",
    },
  ];
  for (const log of logs) {
    const res = await s.b.request("POST", "/v1/attendance", log, { headers: key() });
    expect(res.statusCode, res.body).toBe(201);
  }
  return { semesterId };
}

async function exportedData(s: Student, semesterId: string): Promise<SemesterImportBody> {
  const res = await s.b.request("GET", `/v1/semesters/${semesterId}/export.xlsx`);
  expect(res.statusCode).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);
  const sheet = wb.getWorksheet(SPREADSHEET_DATA_SHEET)!;
  expect(sheet.state).toBe("veryHidden");
  let json = "";
  for (let row = 2; row <= sheet.rowCount; row++) json += sheet.getCell(`A${row}`).text;
  return spreadsheetDataSchema.parse(JSON.parse(json)).data;
}

const subjectsOf = async (s: Student, semesterId: string) =>
  subjectsResponseSchema
    .parse((await s.b.request("GET", `/v1/semesters/${semesterId}/subjects`)).json())
    .subjects.sort((a, b) => a.name.localeCompare(b.name));

const comparable = (subjects: Awaited<ReturnType<typeof subjectsOf>>) =>
  subjects.map(({ id: _id, semesterId: _s, version: _v, schedules, ...rest }) => ({
    ...rest,
    schedules: schedules.map(({ id: _i, ...x }) => x),
  }));

describe("Importar planilha exportada (POST /v1/imports/semester)", () => {
  it("recria o semestre igual ao exportado, sem avisos de faltas antigas, e repete pela mesma chave", async () => {
    const ana = await student();
    const { semesterId } = await fullSemester(ana);
    const body = await exportedData(ana, semesterId);
    expect(body.attendance).toHaveLength(8);
    expect(body.exceptions).toEqual([
      {
        startsOn: "2026-04-21",
        endsOn: "2026-04-21",
        kind: "holiday",
        label: "Tiradentes",
        subjectIndex: null,
      },
    ]);

    const bia = await student();
    const before = await unread(bia);
    const headers = key();
    const res = await bia.b.request("POST", "/v1/imports/semester", body, { headers });
    expect(res.statusCode, res.body).toBe(201);
    const result = semesterImportResultSchema.parse(res.json());
    expect(result).toMatchObject({ label: "2026.1", subjects: 2, attendance: 8 });

    expect(comparable(await subjectsOf(bia, result.semesterId))).toEqual(
      comparable(await subjectsOf(ana, semesterId)),
    );
    expect(await unread(bia)).toBe(before);

    const again = await bia.b.request("POST", "/v1/imports/semester", body, { headers });
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(semesterImportResultSchema.parse(again.json()).semesterId).toBe(result.semesterId);

    const own = await ana.b.request("POST", "/v1/imports/semester", body, { headers: key() });
    expect(own.statusCode, own.body).toBe(201);
    expect(semesterImportResultSchema.parse(own.json()).label).toBe("2026.1 (2)");

    const semesters = (await bia.b.request("GET", "/v1/semesters")).json<{
      semesters: { id: string; isCurrent: boolean }[];
    }>().semesters;
    expect(semesters).toEqual([
      expect.objectContaining({ id: result.semesterId, isCurrent: true }),
    ]);
  });

  it("recusa registros inconsistentes apontando o item, sem gravar nada", async () => {
    const ana = await student();
    const { semesterId } = await fullSemester(ana);
    const body = await exportedData(ana, semesterId);
    const bia = await student();

    const cases: [string, (b: SemesterImportBody) => void, string, RegExp][] = [
      [
        "fora do semestre",
        (b) => (b.attendance[0]!.classDate = "2026-08-03"),
        "attendance.0.classDate",
        /fora do semestre/,
      ],
      [
        "dia da semana errado",
        (b) => (b.attendance[0]!.classDate = "2026-03-03"),
        "attendance.0.scheduleIndex",
        /dia da semana/,
      ],
      [
        "aula repetida",
        (b) => b.attendance.push({ ...b.attendance[1]! }),
        "attendance.8",
        /repetida/,
      ],
      [
        "matéria inexistente",
        (b) => (b.attendance[0]!.subjectIndex = 5),
        "attendance.0.subjectIndex",
        /matéria não existe/,
      ],
      [
        "feriado fora do semestre",
        (b) => (b.exceptions[0]!.startsOn = b.exceptions[0]!.endsOn = "2027-01-01"),
        "exceptions.0",
        /fora do semestre/,
      ],
      [
        "data no futuro",
        (b) => {
          b.semester.endsOn = "2099-12-31";
          b.attendance.push({
            subjectIndex: 1,
            scheduleIndex: null,
            classDate: "2099-12-30",
            status: "present",
            isExcused: false,
          });
        },
        "attendance.8.classDate",
        /futuro/,
      ],
    ];
    for (const [name, mutate, path, message] of cases) {
      const changed = structuredClone(body);
      mutate(changed);
      const res = await bia.b.request("POST", "/v1/imports/semester", changed, { headers: key() });
      expect(res.statusCode, name).toBe(422);
      const p = problem(res);
      expect(p.code, name).toBe("IMPORT_INVALID");
      expect(p.errors?.[0]?.path, name).toBe(path);
      expect(p.errors?.[0]?.message, name).toMatch(message);
    }
    expect((await bia.b.request("GET", "/v1/semesters")).json()).toEqual({ semesters: [] });

    const bad = await bia.b.request(
      "POST",
      "/v1/imports/semester",
      { ...body, subjects: "x" },
      { headers: key() },
    );
    expect(bad.statusCode).toBe(422);
    const noKey = await bia.b.request("POST", "/v1/imports/semester", body);
    expect(noKey.statusCode).toBe(428);
  });

  it("exige sessão", async () => {
    const res = await new Browser(env.app).request(
      "POST",
      "/v1/imports/semester",
      {},
      {
        headers: key(),
      },
    );
    expect([401, 403]).toContain(res.statusCode);
  });
});
