import { describe, expect, it } from "vitest";
import { maxAbsenceUnits, projectedPresence, riskLevel, totalUnits } from "./index";

describe("maxAbsenceUnits", () => {
  it("60 h hora-relógio, tempo de 50 min, 75% → 18 tempos", () => {
    const rules = {
      mode: "workload",
      workloadHours: 60,
      workloadHourMinutes: 60,
      unitMinutes: 50,
      unitsPerClass: 2,
      minAttendanceBp: 7500,
    } as const;
    expect(totalUnits(rules)).toBe(72);
    expect(maxAbsenceUnits(rules)).toBe(18);
  });

  it("36 aulas de 1 chamada, 75% → 9", () => {
    expect(
      maxAbsenceUnits({
        mode: "class_count",
        totalClasses: 36,
        unitsPerClass: 1,
        minAttendanceBp: 7500,
      }),
    ).toBe(9);
  });

  it("80 h com tempo de 60 min, 85% → 12", () => {
    expect(
      maxAbsenceUnits({
        mode: "workload",
        workloadHours: 80,
        workloadHourMinutes: 60,
        unitMinutes: 60,
        unitsPerClass: 2,
        minAttendanceBp: 8500,
      }),
    ).toBe(12);
  });

  it("68 h, tempo de 50 min, 75% → 20,4 arredonda para 20", () => {
    expect(
      maxAbsenceUnits({
        mode: "workload",
        workloadHours: 68,
        workloadHourMinutes: 60,
        unitMinutes: 50,
        unitsPerClass: 1,
        minAttendanceBp: 7500,
      }),
    ).toBe(20);
  });

  it("40 aulas, 80% → 8 (em ponto flutuante daria 7)", () => {
    expect(Math.floor(40 * (1 - 0.8))).toBe(7); // o bug que o motor evita
    expect(
      maxAbsenceUnits({
        mode: "class_count",
        totalClasses: 40,
        unitsPerClass: 1,
        minAttendanceBp: 8000,
      }),
    ).toBe(8);
  });

  it("carga com fração não perde minuto por ponto flutuante (33,3 h = 1998 min)", () => {
    expect(Math.floor(33.3 * 60)).toBe(1997); // o bug que o motor evita
    const rules = {
      mode: "workload",
      workloadHours: 33.3,
      workloadHourMinutes: 60,
      unitMinutes: 1,
      unitsPerClass: 1,
      minAttendanceBp: 0,
    } as const;
    expect(totalUnits(rules)).toBe(1998);
    expect(maxAbsenceUnits(rules)).toBe(1998);
  });

  it("recusa tempos por encontro igual a zero", () => {
    expect(() => maxAbsenceUnits({ mode: "manual", manualMaxUnits: 3, unitsPerClass: 0 })).toThrow(
      /unitsPerClass/,
    );
  });

  it("recusa presença mínima fora de 0–100%", () => {
    expect(() =>
      maxAbsenceUnits({
        mode: "class_count",
        totalClasses: 10,
        unitsPerClass: 1,
        minAttendanceBp: 10_001,
      }),
    ).toThrow(RangeError);
  });
});

describe("riskLevel", () => {
  it.each([
    [0, 18, 2, "safe"],
    [9, 18, 2, "warning"],
    [14, 18, 2, "critical"],
    [3, 6, 2, "critical"], // só 50% consumido, mas restam 3 tempos = 1 encontro
    [18, 18, 2, "limit"],
    [19, 18, 2, "failed"],
  ] as const)("A=%i, F=%i, %i tempos/encontro → %s", (a, f, upc, expected) => {
    expect(riskLevel(a, f, upc)).toBe(expected);
  });

  it("não começa laranja com zero faltas mesmo com margem curta", () => {
    expect(riskLevel(0, 4, 2)).toBe("safe");
  });
});

describe("projectedPresence", () => {
  it("trunca em vez de arredondar para cima", () => {
    expect(projectedPresence(72, 6)).toBe(91.6);
    expect(projectedPresence(36, 4)).toBe(88.8);
  });
});
