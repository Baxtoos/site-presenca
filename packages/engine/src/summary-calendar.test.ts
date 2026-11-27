import { describe, expect, it } from "vitest";
import { addDays, classOccurrences, isoWeekday, planSkips } from "./calendar";
import { summarize } from "./summary";

const CALCULO = {
  mode: "workload",
  workloadHours: 60,
  workloadHourMinutes: 60,
  unitMinutes: 50,
  unitsPerClass: 2,
  minAttendanceBp: 7500,
} as const;

describe("summarize", () => {
  it("monta o card da matéria a partir das regras e dos totais", () => {
    expect(summarize(CALCULO, { unitsCounted: 6, unitsExcused: 0, unitsHeld: 56 })).toEqual({
      totalUnits: 72,
      maxAbsenceUnits: 18,
      absentUnits: 6,
      excusedUnits: 0,
      heldUnits: 56,
      remainingUnits: 12,
      remainingClasses: 6,
      exceededBy: 0,
      consumptionPct: 33,
      risk: "safe",
      projectedPresencePct: 91.6,
      presenceSoFarPct: 89.2,
    });
  });

  it("acima do limite: saldo negativo vira 'excedeu em', zero encontros restantes", () => {
    const s = summarize(CALCULO, { unitsCounted: 20, unitsExcused: 0, unitsHeld: 60 });
    expect(s).toMatchObject({
      remainingUnits: -2,
      remainingClasses: 0,
      exceededBy: 2,
      risk: "failed",
    });
  });

  it("limite manual sem total de aulas: sem presença projetada", () => {
    const s = summarize(
      { mode: "manual", manualMaxUnits: 10, unitsPerClass: 1 },
      { unitsCounted: 3, unitsExcused: 1, unitsHeld: 0 },
    );
    expect(s).toMatchObject({
      totalUnits: null,
      projectedPresencePct: null,
      presenceSoFarPct: null,
      remainingUnits: 7,
    });
  });
});

describe("calendário", () => {
  it("dia da semana ISO", () => {
    expect(isoWeekday("2026-11-16")).toBe(1);
    expect(isoWeekday("2026-11-22")).toBe(7);
  });

  it("anda de dia em dia atravessando meses e anos bissextos", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("recusa data inexistente", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });

  it("gera as aulas da grade sem os feriados (semana de provas não cancela aula)", () => {
    const aulas = classOccurrences({
      schedules: [
        { id: "seg", weekday: 1, units: 2 },
        { id: "qua", weekday: 3, units: 2 },
      ],
      exceptions: [
        { startsOn: "2026-11-02", endsOn: "2026-11-02", kind: "holiday" },
        { startsOn: "2026-11-09", endsOn: "2026-11-13", kind: "exam_week" },
      ],
      from: "2026-11-01",
      to: "2026-11-13",
    });
    expect(aulas.map((a) => a.date)).toEqual(["2026-11-04", "2026-11-09", "2026-11-11"]);
    expect(aulas[0]).toEqual({ date: "2026-11-04", units: 2, scheduleId: "qua" });
  });

  it("respeita troca de horário no meio do semestre (validFrom/validUntil)", () => {
    const aulas = classOccurrences({
      schedules: [
        { weekday: 2, units: 1, validUntil: "2026-11-10" },
        { weekday: 4, units: 1, validFrom: "2026-11-11" },
      ],
      exceptions: [],
      from: "2026-11-02",
      to: "2026-11-20",
    });
    expect(aulas.map((a) => a.date)).toEqual([
      "2026-11-03",
      "2026-11-10",
      "2026-11-12",
      "2026-11-19",
    ]);
  });

  it("posso faltar: aulas geminadas consomem o saldo mais rápido", () => {
    const upcoming = [
      { date: "2026-11-23", units: 2 },
      { date: "2026-11-25", units: 2 },
      { date: "2026-11-27", units: 1 },
      { date: "2026-11-30", units: 2 },
    ];
    expect(planSkips(5, upcoming)).toEqual({
      classes: 3,
      units: 5,
      untilDate: "2026-11-27",
      firstUnsafe: { date: "2026-11-30", units: 2 },
    });
    expect(planSkips(1, upcoming)).toMatchObject({ classes: 0, untilDate: null });
  });
});
