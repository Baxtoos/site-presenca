import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classOccurrences, isoWeekday, planSkips, type ClassOccurrence } from "./calendar";
import { consumptionPct, presencePct, RISK_ORDER, riskLevel } from "./risk";
import { FULL_BP, maxAbsenceUnits, totalUnits, workloadMinutes } from "./rules";

const RUNS = { numRuns: 2_000 };

const bp = fc.integer({ min: 0, max: FULL_BP });
const unitsPerClass = fc.integer({ min: 1, max: 6 });

describe("propriedades do limite de faltas", () => {
  it("por aulas: F é exatamente o piso de T × (1 − p), sem erro de arredondamento", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), unitsPerClass, bp, (classes, upc, minBp) => {
        const F = maxAbsenceUnits({
          mode: "class_count",
          totalClasses: classes,
          unitsPerClass: upc,
          minAttendanceBp: minBp,
        });
        const exact = classes * upc * (FULL_BP - minBp); // T × (1 − p) × 10000, inteiro
        // F × 10000 ≤ exato < (F + 1) × 10000  ⇔  F = ⌊exato / 10000⌋
        expect(F * FULL_BP).toBeLessThanOrEqual(exact);
        expect((F + 1) * FULL_BP).toBeGreaterThan(exact);
      }),
      RUNS,
    );
  });

  it("por carga horária: F é o piso dos minutos permitidos ÷ minutos por tempo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40_000 }).map((centi) => centi / 100), // até 400 h, 2 casas
        fc.constantFrom(45, 50, 60),
        fc.integer({ min: 10, max: 240 }),
        bp,
        (hours, hourMinutes, unitMinutes, minBp) => {
          const rules = {
            mode: "workload" as const,
            workloadHours: hours,
            workloadHourMinutes: hourMinutes,
            unitMinutes,
            unitsPerClass: 1,
            minAttendanceBp: minBp,
          };
          const minutes = workloadMinutes(hours, hourMinutes);
          const F = maxAbsenceUnits(rules);
          const exact = minutes * (FULL_BP - minBp);
          expect(F * FULL_BP * unitMinutes).toBeLessThanOrEqual(exact);
          expect((F + 1) * FULL_BP * unitMinutes).toBeGreaterThan(exact);
          expect(F).toBeLessThanOrEqual(totalUnits(rules)!);
        },
      ),
      RUNS,
    );
  });

  it("carga com até 2 casas decimais vira minutos exatos (sem perder minuto por float)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.constantFrom(45, 50, 60),
        (centi, hm) => {
          expect(workloadMinutes(centi / 100, hm)).toBe(Math.floor((centi * hm) / 100));
        },
      ),
      RUNS,
    );
  });

  it("exigir mais presença nunca aumenta o limite", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), unitsPerClass, bp, bp, (classes, upc, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const f = (minBp: number) =>
          maxAbsenceUnits({
            mode: "class_count",
            totalClasses: classes,
            unitsPerClass: upc,
            minAttendanceBp: minBp,
          });
        expect(f(high)).toBeLessThanOrEqual(f(low));
      }),
      RUNS,
    );
  });
});

describe("propriedades do semáforo e das porcentagens", () => {
  it("mais faltas nunca deixam o risco menor", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 220 }),
        unitsPerClass,
        (max, absent, upc) => {
          const now = RISK_ORDER.indexOf(riskLevel(absent, max, upc));
          const next = RISK_ORDER.indexOf(riskLevel(absent + 1, max, upc));
          expect(next).toBeGreaterThanOrEqual(now);
        },
      ),
      RUNS,
    );
  });

  it("acima do limite é sempre reprovado; exatamente no limite, nunca", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), unitsPerClass, (max, upc) => {
        expect(riskLevel(max, max, upc)).toBe("limit");
        expect(riskLevel(max + 1, max, upc)).toBe("failed");
      }),
      RUNS,
    );
  });

  it("presença fica entre 0 e 100, cai com faltas e nunca é arredondada para cima", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        (total, absent) => {
          const a = Math.min(absent, total);
          const p = presencePct(total, a);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(100);
          expect(p * total).toBeLessThanOrEqual((total - a) * 100 + 1e-9);
          if (a < total) expect(presencePct(total, a + 1)).toBeLessThanOrEqual(p);
        },
      ),
      RUNS,
    );
  });

  it("consumo chega a 100% exatamente quando as faltas alcançam o limite", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 400 }),
        (max, absent) => {
          expect(consumptionPct(absent, max) >= 100).toBe(absent >= max);
        },
      ),
      RUNS,
    );
  });
});

describe("propriedades do calendário", () => {
  const date = fc
    .date({
      min: new Date("2026-01-01T00:00:00Z"),
      max: new Date("2027-12-31T00:00:00Z"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10));
  const slot = fc.record({
    weekday: fc.integer({ min: 1, max: 7 }),
    units: fc.integer({ min: 1, max: 4 }),
  });
  const exception = fc
    .tuple(
      date,
      fc.integer({ min: 0, max: 10 }),
      fc.constantFrom("holiday" as const, "no_classes" as const, "exam_week" as const),
    )
    .map(([start, len, kind]) => {
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + len);
      return { startsOn: start, endsOn: end.toISOString().slice(0, 10), kind };
    });

  it("toda aula cai num dia da grade, fora de feriado, em ordem e dentro do período", () => {
    fc.assert(
      fc.property(
        fc.array(slot, { maxLength: 5 }),
        fc.array(exception, { maxLength: 4 }),
        date,
        fc.integer({ min: 0, max: 150 }),
        (schedules, exceptions, from, length) => {
          const toDate = new Date(`${from}T00:00:00Z`);
          toDate.setUTCDate(toDate.getUTCDate() + length);
          const to = toDate.toISOString().slice(0, 10);
          const result = classOccurrences({ schedules, exceptions, from, to });
          for (const [i, occ] of result.entries()) {
            expect(occ.date >= from && occ.date <= to).toBe(true);
            expect(
              schedules.some((s) => s.weekday === isoWeekday(occ.date) && s.units === occ.units),
            ).toBe(true);
            const blocked = exceptions.some(
              (e) => e.kind !== "exam_week" && e.startsOn <= occ.date && occ.date <= e.endsOn,
            );
            expect(blocked).toBe(false);
            if (i > 0) expect(occ.date >= result[i - 1]!.date).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("o plano de faltas usa o saldo ao máximo sem nunca passar dele", () => {
    const occurrence = fc.record({ date, units: fc.integer({ min: 1, max: 4 }) });
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 40 }),
        fc.array(occurrence, { maxLength: 30 }),
        (remaining, raw) => {
          const upcoming: ClassOccurrence[] = [...raw].sort((a, b) => a.date.localeCompare(b.date));
          const plan = planSkips(remaining, upcoming);
          expect(plan.units).toBeLessThanOrEqual(Math.max(0, remaining));
          expect(plan.units).toBe(upcoming.slice(0, plan.classes).reduce((s, o) => s + o.units, 0));
          if (plan.firstUnsafe) {
            expect(plan.units + plan.firstUnsafe.units).toBeGreaterThan(remaining);
            expect(plan.firstUnsafe).toBe(upcoming[plan.classes]);
          } else {
            expect(plan.classes).toBe(upcoming.length);
          }
        },
      ),
      RUNS,
    );
  });
});
