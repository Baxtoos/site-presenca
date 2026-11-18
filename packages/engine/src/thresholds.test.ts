import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateThresholds, THRESHOLDS, type ThresholdState } from "./thresholds";

/** Aplica as mudanças sobre o estado atual, como a API faz no banco. */
function apply(current: ThresholdState[], changes: ThresholdState[]): ThresholdState[] {
  const map = new Map(current.map((s) => [s.pct, s]));
  for (const c of changes) map.set(c.pct, c);
  return [...map.values()].sort((a, b) => a.pct - b.pct);
}

describe("evaluateThresholds", () => {
  it("sem faltas: nada muda, nada é avisado", () => {
    expect(evaluateThresholds(0, [])).toEqual({ changes: [], notify: null, skipped: [] });
  });

  it("cruzar 50%: desarma, ciclo 1 e avisa", () => {
    const r = evaluateThresholds(55, []);
    expect(r.notify).toEqual({ pct: 50, armed: false, cycle: 1 });
    expect(r.changes).toEqual([{ pct: 50, armed: false, cycle: 1 }]);
    expect(r.skipped).toEqual([]);
  });

  it("exatamente no marco conta como cruzado", () => {
    expect(evaluateThresholds(75, []).notify?.pct).toBe(75);
    expect(evaluateThresholds(74, []).notify?.pct).toBe(50);
  });

  it("de 45% para 80% de uma vez: só o 75% é enviado; o 50% fica como pulado", () => {
    const r = evaluateThresholds(80, []);
    expect(r.notify?.pct).toBe(75);
    expect(r.skipped.map((s) => s.pct)).toEqual([50]);
    expect(r.changes.map((s) => s.pct)).toEqual([50, 75]);
  });

  it("passar do limite (130%) com tudo armado: avisa o 100%", () => {
    const r = evaluateThresholds(130, []);
    expect(r.notify?.pct).toBe(100);
    expect(r.skipped.map((s) => s.pct)).toEqual([50, 75, 90]);
  });

  it("marco já desarmado não avisa de novo enquanto o consumo continua acima", () => {
    const state = apply([], evaluateThresholds(60, []).changes);
    expect(evaluateThresholds(70, state)).toEqual({ changes: [], notify: null, skipped: [] });
  });

  it("rearme: apagar a falta e voltar a cruzar gera um novo ciclo", () => {
    let state = apply([], evaluateThresholds(60, []).changes);
    const down = evaluateThresholds(30, state);
    expect(down.notify).toBeNull();
    expect(down.changes).toEqual([{ pct: 50, armed: true, cycle: 1 }]);
    state = apply(state, down.changes);
    const up = evaluateThresholds(55, state);
    expect(up.notify).toEqual({ pct: 50, armed: false, cycle: 2 });
  });

  it("marco que o aluno desligou muda de estado, mas não avisa", () => {
    const r = evaluateThresholds(60, [], [75, 90, 100]);
    expect(r.notify).toBeNull();
    expect(r.changes).toEqual([{ pct: 50, armed: false, cycle: 1 }]);
  });

  it("com o 75% desligado, ir de 0 a 80% avisa o 50%", () => {
    const r = evaluateThresholds(80, [], [50, 90, 100]);
    expect(r.notify?.pct).toBe(50);
    expect(r.skipped).toEqual([]);
  });

  it("recusa consumo inválido", () => {
    expect(() => evaluateThresholds(-1, [])).toThrow(RangeError);
    expect(() => evaluateThresholds(50.5, [])).toThrow(RangeError);
  });
});

describe("propriedades", () => {
  const sequence = fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 1, maxLength: 40 });

  it("cada ciclo de cada marco é avisado no máximo uma vez, e só subindo", () => {
    fc.assert(
      fc.property(sequence, (consumptions) => {
        let state: ThresholdState[] = [];
        let previous = 0;
        const seen = new Set<string>();
        for (const c of consumptions) {
          const r = evaluateThresholds(c, state);
          for (const s of [r.notify, ...r.skipped].filter((x) => x !== null)) {
            const key = `${s.pct}:${s.cycle}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
            // Só se avisa um marco ao cruzá-lo para cima.
            expect(c).toBeGreaterThanOrEqual(s.pct);
            expect(previous).toBeLessThan(s.pct);
          }
          state = apply(state, r.changes);
          previous = c;
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("depois de cada avaliação, armado ⇔ consumo abaixo do marco", () => {
    fc.assert(
      fc.property(sequence, (consumptions) => {
        let state: ThresholdState[] = [];
        for (const c of consumptions) {
          state = apply(state, evaluateThresholds(c, state).changes);
          for (const pct of THRESHOLDS) {
            const s = state.find((x) => x.pct === pct) ?? { pct, armed: true, cycle: 0 };
            expect(s.armed).toBe(c < pct);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("no máximo um aviso enviado por mudança, e é o marco mais grave cruzado", () => {
    fc.assert(
      fc.property(sequence, (consumptions) => {
        let state: ThresholdState[] = [];
        for (const c of consumptions) {
          const r = evaluateThresholds(c, state);
          if (r.notify) {
            for (const s of r.skipped) expect(s.pct).toBeLessThan(r.notify.pct);
          } else {
            expect(r.skipped).toEqual([]);
          }
          state = apply(state, r.changes);
        }
      }),
      { numRuns: 2000 },
    );
  });
});
