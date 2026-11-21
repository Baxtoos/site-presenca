import type { SuapSubject } from "@presenca/contracts";
import { describe, expect, it } from "vitest";
import {
  attendanceFrom,
  lessonsByDate,
  mergeSlots,
  prettyName,
  roomFrom,
  rulesFor,
  semesterRange,
} from "./suap.mapper";

describe("suap.mapper", () => {
  it.each([
    ["ENGENHARIA DE SOFTWARE 1", "Engenharia de Software 1"],
    ["BANCOS DE DADOS 2", "Bancos de Dados 2"],
    ["COMPUTAÇÃO GRÁFICA", "Computação Gráfica"],
    ["CÁLCULO II", "Cálculo II"],
    ["Já Formatado da Silva", "Já Formatado da Silva"],
    ["EDSON MURAKAMI", "Edson Murakami"],
  ])("prettyName(%s)", (input, expected) => {
    expect(prettyName(input)).toBe(expected);
  });

  it("roomFrom pega os códigos das salas", () => {
    expect(
      roomFrom(
        "D107 - Laboratório de Informática - Prédio Câmpus Salto (SLT) e C108 - Sala de Aula - Prédio Câmpus Salto (SLT)",
      ),
    ).toBe("D107 / C108");
    expect(roomFrom("Sala sem código")).toBe("Sala sem código");
    expect(roomFrom(null)).toBeNull();
  });

  it("mergeSlots junta tempos seguidos (intervalo curto não separa)", () => {
    expect(
      mergeSlots([
        { weekday: 2, startsAt: "10:40", endsAt: "11:30" },
        { weekday: 2, startsAt: "08:50", endsAt: "09:40" },
        { weekday: 2, startsAt: "09:40", endsAt: "10:30" },
        { weekday: 2, startsAt: "11:30", endsAt: "12:20" },
        { weekday: 4, startsAt: "19:00", endsAt: "19:50" },
        { weekday: 4, startsAt: "19:50", endsAt: "20:40" },
        { weekday: 4, startsAt: "21:45", endsAt: "22:35" },
      ]),
    ).toEqual([
      { weekday: 2, startsAt: "08:50", endsAt: "12:20", units: 4 },
      { weekday: 4, startsAt: "19:00", endsAt: "20:40", units: 2 },
      { weekday: 4, startsAt: "21:45", endsAt: "22:35", units: 1 },
    ]);
  });

  it("lessonsByDate soma duas linhas do mesmo dia", () => {
    expect(
      lessonsByDate([
        { date: "2026-08-18", units: 2, absences: 2, excused: false, content: "" },
        { date: "2026-08-11", units: 4, absences: 0, excused: false, content: "" },
        { date: "2026-08-18", units: 2, absences: 0, excused: true, content: "B" },
      ]),
    ).toEqual([
      { date: "2026-08-11", units: 4, absences: 0, excused: false, content: "" },
      { date: "2026-08-18", units: 4, absences: 2, excused: true, content: "B" },
    ]);
  });

  it("attendanceFrom: presença, falta, parcial e abono", () => {
    const base = { date: "2026-08-18", content: "" };
    expect(attendanceFrom({ ...base, units: 4, absences: 0, excused: false })).toEqual({
      status: "present",
      unitsScheduled: 4,
      unitsMissed: 0,
      isExcused: false,
    });
    expect(attendanceFrom({ ...base, units: 4, absences: 4, excused: true })).toMatchObject({
      status: "absent",
      isExcused: true,
    });
    expect(attendanceFrom({ ...base, units: 4, absences: 2, excused: false })).toMatchObject({
      status: "partial",
      unitsMissed: 2,
    });
    // Mais de 6 tempos num dia: o app guarda até 6.
    expect(attendanceFrom({ ...base, units: 8, absences: 8, excused: false })).toMatchObject({
      status: "absent",
      unitsScheduled: 6,
      unitsMissed: 6,
    });
  });

  it("rulesFor: aulas previstas viram número de aulas com 75%", () => {
    const subject = (plannedUnits: number | null, units: number[]): SuapSubject => ({
      diario: "1",
      code: "X",
      name: "X",
      plannedUnits,
      deliveredUnits: null,
      absences: null,
      frequencyPct: null,
      professor: null,
      location: null,
      slots: [],
      lessons: units.map((u, i) => ({
        date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        units: u,
        absences: 0,
        excused: false,
        content: "",
      })),
    });
    expect(rulesFor(subject(76, [4, 4, 4]), [])).toEqual({
      unitsPerClass: 4,
      countingMode: "class_count",
      totalClasses: 19,
      minAttendanceBp: 7500,
    });
    // 80 não divide por 3: 80 aulas de 1 tempo (o total é o mesmo).
    expect(rulesFor(subject(80, [3, 3]), [])).toMatchObject({ unitsPerClass: 1, totalClasses: 80 });
    expect(rulesFor(subject(null, []), [])).toMatchObject({ countingMode: "manual" });
  });

  it("semesterRange cobre as aulas lançadas", () => {
    expect(semesterRange("2026_2", ["2026-07-28", "2026-12-15"])).toEqual({
      label: "2026.2",
      startsOn: "2026-07-28",
      endsOn: "2026-12-18",
    });
    expect(semesterRange("2026_1", [])).toEqual({
      label: "2026.1",
      startsOn: "2026-02-02",
      endsOn: "2026-07-03",
    });
  });
});
