import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildImport,
  type Cell,
  type Choice,
  defaultSemester,
  defaultSubjects,
  detectLayout,
  extractRecords,
  guessChoice,
  NO_STATUS,
  parseCsv,
  parseDate,
  readTables,
  type SubjectConfig,
  type Table,
  tokensOf,
} from "./own-spreadsheet";

const TODAY = "2026-11-19";

/** Fluxo completo: detecta, extrai, aceita os palpites e monta o corpo. */
function run(
  table: Table,
  edit: (subjects: SubjectConfig[]) => void = () => {},
  choices: Record<string, Choice | null> = {},
) {
  const layout = detectLayout(table, TODAY);
  const records = extractRecords(table, layout, TODAY);
  const guessed = Object.fromEntries(
    tokensOf(records).map((t) => [t.token, guessChoice(t.token).choice]),
  );
  const allChoices = { ...guessed, ...choices };
  const subjects = defaultSubjects(records, allChoices, TODAY);
  edit(subjects);
  const result = buildImport({
    records,
    choices: allChoices,
    subjects,
    semester: defaultSemester(records, TODAY),
    today: TODAY,
  });
  return { layout, records, subjects, result };
}

const withTimes = (subjects: SubjectConfig[]) => {
  for (const s of subjects) {
    s.startsAt = "19:00";
    s.endsAt = "20:40";
  }
};

describe("parseDate", () => {
  it.each<[Cell, string | null]>([
    ["02/03/2026", "2026-03-02"],
    ["2/3/26", "2026-03-02"],
    ["2026-03-02", "2026-03-02"],
    ["02.03.2026", "2026-03-02"],
    ["02/03", "2026-03-02"],
    ["seg, 02/03", "2026-03-02"],
    ["2 de março", "2026-03-02"],
    ["12-dez", "2025-12-12"], // ainda não chegou em 2026: ano anterior
    ["31/02/2026", null],
    ["Cálculo", null],
    [new Date(Date.UTC(2026, 2, 2)), "2026-03-02"],
    [42, null],
  ])("%s → %s", (cell, expected) => {
    expect(parseDate(cell, TODAY)).toBe(expected);
  });
});

describe("guessChoice", () => {
  it.each<[string, Choice | null, number | null]>([
    ["p", "present", null],
    ["presente", "present", null],
    ["f", "absent", null],
    ["falta", "absent", null],
    ["atestado", "excused", null],
    ["falta justificada", "excused", null],
    ["cancelada", "cancelled", null],
    ["feriado", "cancelled", null],
    ["-", "ignore", null],
    ["0", "present", null],
    ["2", "absent", 2],
    ["x", null, null],
    ["talvez", null, null],
    [NO_STATUS, "absent", null],
  ])("%s", (token, choice, units) => {
    expect(guessChoice(token)).toEqual({ choice, units });
  });
});

describe("planilha própria", () => {
  it("lista com cabeçalho: uma linha por aula, com grade, parcial, atestado e cancelada", () => {
    const { layout, subjects, result } = run(
      {
        name: "Presenças",
        rows: [
          ["Minhas presenças 2026.1"],
          [],
          ["Data", "Matéria", "Situação", "Tempos", "Motivo", "Obs"],
          ["02/03/2026", "Cálculo II", "P", null, null, null],
          ["04/03/2026", "Cálculo II", "F", null, "ônibus quebrou", null],
          ["09/03/2026", "Cálculo II", "F", 1, null, "cheguei atrasado"],
          ["11/03/2026", "Cálculo II", "Atestado", null, null, null],
          ["16/03/2026", "Cálculo II", "Cancelada", null, null, null],
          ["14/03/2026", "Cálculo II", "F", null, null, "reposição no sábado"],
          ["06/03/2026", "Física", "P", null, null, null],
          ["13/03/2026", "Física", "falta", null, null, null],
        ],
      },
      withTimes,
    );
    expect(layout).toEqual({
      kind: "list",
      header: 2,
      columns: { date: 0, subject: 1, status: 2, units: 3, reason: 4, note: 5 },
    });
    // Seg e Qua aparecem 3 e 2 vezes; o sábado (uma vez) vira aula avulsa.
    expect(subjects.map((s) => [s.name, s.weekdays])).toEqual([
      ["Cálculo II", [1, 3]],
      ["Física", [5]],
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.counts).toEqual({ absences: 5, presences: 2, cancelled: 1, skipped: 0 });
    const byDate = Object.fromEntries(result.body.attendance.map((a) => [a.classDate, a]));
    expect(byDate["2026-03-04"]).toMatchObject({
      subjectIndex: 0,
      scheduleIndex: 1,
      status: "absent",
      reason: "transport",
      note: "Motivo: ônibus quebrou",
    });
    expect(byDate["2026-03-09"]).toMatchObject({
      scheduleIndex: 0,
      status: "partial",
      unitsMissed: 1,
      note: "cheguei atrasado",
    });
    expect(byDate["2026-03-11"]).toMatchObject({
      status: "absent",
      isExcused: true,
      reason: "health",
    });
    expect(byDate["2026-03-16"]).toMatchObject({ status: "cancelled" });
    expect(byDate["2026-03-14"]).toMatchObject({
      scheduleIndex: null,
      unitsScheduled: 2,
      status: "absent",
    });
    expect(result.body.subjects[0]).toMatchObject({
      countingMode: "workload",
      workloadHours: 60,
      unitsPerClass: 2,
      schedules: [
        { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2 },
        { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2 },
      ],
    });
    expect(result.body.semester).toEqual({
      label: "2026.1",
      startsOn: "2026-03-02",
      endsOn: "2026-07-03",
    });
  });

  it("chamada com datas nas colunas (sem ano), números como tempos de falta", () => {
    const { layout, result } = run(
      {
        name: "Chamada",
        rows: [
          ["Disciplina", "02/03", "04/03", "09/03", "11/03"],
          ["Cálculo II", "P", "F", "1", null],
          ["Física", "F", null, "P", "AT"],
        ],
      },
      withTimes,
    );
    expect(layout).toMatchObject({ kind: "dates-across", header: 0, name: 0 });
    if (!result.ok) throw new Error(result.error);
    expect(result.body.subjects.map((s) => s.schedules.map((x) => x.weekday))).toEqual([
      [1, 3],
      [1, 3],
    ]);
    expect(
      result.body.attendance.map((a) => [a.subjectIndex, a.classDate, a.scheduleIndex, a.status]),
    ).toEqual([
      [0, "2026-03-02", 0, "present"],
      [1, "2026-03-02", 0, "absent"],
      [0, "2026-03-04", 1, "absent"],
      [0, "2026-03-09", 0, "partial"],
      [1, "2026-03-09", 0, "present"],
      [1, "2026-03-11", 1, "absent"],
    ]);
  });

  it("chamada com datas nas linhas e uma coluna por matéria", () => {
    const { layout, records } = run({
      name: "Planilha1",
      rows: [
        ["Dia", "Cálculo II", "Física"],
        [new Date(Date.UTC(2026, 2, 2)), "P", null],
        [new Date(Date.UTC(2026, 2, 6)), null, "F"],
      ],
    });
    expect(layout).toMatchObject({ kind: "dates-down", date: 0 });
    expect(records.map((r) => [r.subject, r.date, r.token])).toEqual([
      ["Cálculo II", "2026-03-02", "p"],
      ["Física", "2026-03-06", "f"],
    ]);
  });

  it("CSV do Excel com ponto e vírgula e coluna de situação sem nome conhecido", () => {
    const rows = parseCsv(
      'Data;Disciplina;P/F;Obs\r\n02/03/2026;Cálculo;P;\r\n04/03/2026;Cálculo;F;"chuva; trânsito"\r\n',
    );
    expect(rows[2]).toEqual(["04/03/2026", "Cálculo", "F", "chuva; trânsito"]);
    const { layout, result } = run({ name: "faltas", rows }, withTimes);
    expect(layout).toMatchObject({ kind: "list", columns: { subject: 1, status: 2, note: 3 } });
    if (!result.ok) throw new Error(result.error);
    expect(result.counts.absences).toBe(1);
    expect(result.counts.presences).toBe(1);
  });

  it("lista só de faltas, sem matéria nem situação: a aba é a matéria e cada linha uma falta", () => {
    const { records, result } = run(
      {
        name: "Física",
        rows: [
          ["Data", "Observação"],
          ["06/03/2026", "dentista"],
          ["13/03/2026", null],
        ],
      },
      withTimes,
    );
    expect(records.map((r) => [r.subject, r.token])).toEqual([
      ["Física", NO_STATUS],
      ["Física", NO_STATUS],
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.counts.absences).toBe(2);
  });

  it("marcação ambígua exige escolha; depois disso importa", () => {
    const table: Table = {
      name: "Chamada",
      rows: [
        ["Matéria", "02/03", "04/03", "09/03"],
        ["Cálculo", "x", "x", "P"],
      ],
    };
    expect(run(table).result).toEqual({
      ok: false,
      error: expect.stringMatching(/cada marcação/),
    });
    const { result } = run(table, withTimes, { x: "absent" });
    expect(result.ok && result.counts.absences).toBe(2);
  });

  it("junta duas linhas da mesma aula avulsa, deixa de fora o futuro e pede horário", () => {
    const table: Table = {
      name: "Lista",
      rows: [
        ["Data", "Matéria", "Situação"],
        ["07/03/2026", "Cálculo", "F"],
        ["07/03/2026", "Cálculo", "F"],
        ["10/12/2026", "Cálculo", "F"],
      ],
    };
    // Sem grade (dias desmarcados): as duas faltas do mesmo dia viram uma aula avulsa de 4 tempos.
    const { subjects, result } = run(table, (s) => {
      s[0]!.weekdays = [];
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.body.attendance).toEqual([
      expect.objectContaining({ classDate: "2026-03-07", unitsScheduled: 4, status: "absent" }),
    ]);
    expect(result.warnings).toEqual([expect.stringMatching(/1 registro tem data no futuro/)]);

    // O sábado foi detectado (o registro do futuro não conta) e pede o horário.
    expect(run(table).subjects[0]!.weekdays).toEqual([6]);
    expect(subjects).toHaveLength(1);
    const noTime = run(table);
    expect(noTime.result).toEqual({ ok: false, error: expect.stringMatching(/informe o horário/) });
  });

  it("lê .xlsx (só abas visíveis) e .csv", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Chamada");
    sheet.addRow(["Matéria", new Date(Date.UTC(2026, 2, 2)), new Date(Date.UTC(2026, 2, 4))]);
    sheet.addRow(["Cálculo", "P", "F"]);
    wb.addWorksheet("Rascunho", { state: "hidden" }).addRow(["segredo"]);
    const xlsx = await wb.xlsx.writeBuffer();
    const tables = await readTables(xlsx, "minhas presenças.xlsx");
    expect(tables.map((t) => t.name)).toEqual(["Chamada"]);
    expect(detectLayout(tables[0]!, TODAY)).toMatchObject({ kind: "dates-across" });

    const csv = new TextEncoder().encode("\uFEFFData,Matéria,Situação\n02/03/2026,Cálculo,P\n");
    const fromCsv = await readTables(csv.buffer, "chamada.csv");
    expect(fromCsv).toEqual([
      {
        name: "chamada",
        rows: [
          ["Data", "Matéria", "Situação"],
          ["02/03/2026", "Cálculo", "P"],
        ],
      },
    ]);
  });

  it("aba sem datas não é reconhecida", () => {
    expect(detectLayout({ name: "Notas", rows: [["Prova 1", 8.5]] }, TODAY)).toEqual({
      kind: "none",
    });
  });
});
