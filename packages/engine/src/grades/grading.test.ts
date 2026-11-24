import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FormulaError, parseFormula } from "./formula";
import {
  type EvaluationItem,
  formatGrade,
  type GradingRules,
  parseGrade,
  simulateGrades,
  summarizeGrades,
  validateGrading,
} from "./grading";

const item = (
  key: string,
  score: number | null,
  extra: Partial<EvaluationItem> = {},
): EvaluationItem => ({
  key,
  name: key,
  maxScore: 1000,
  group: null,
  role: "regular",
  score,
  ...extra,
});

const base: GradingRules = {
  scale: 10,
  passing: 600,
  formula: "(P1 + P2) / 2",
  groups: [],
  exam: null,
  substitute: null,
  roundingStep: 1,
};

describe("fórmula", () => {
  it("lê números com vírgula, precedência, funções e recusa o resto", () => {
    expect(parseFormula("0,4*P1 + 0.6*P2")).toMatchObject({ type: "bin", op: "+" });
    expect(() => parseFormula("P1 + ")).toThrow(FormulaError);
    expect(() => parseFormula("alert(1)")).toThrow(/Função desconhecida/);
    expect(() => parseFormula("P1; drop table")).toThrow(FormulaError);
    expect(() => parseFormula("P1 `x`")).toThrow(/não permitido/);
    expect(() => parseFormula("(".repeat(60) + "1" + ")".repeat(60))).toThrow(/aninhada/);
  });
});

describe("média simples e ponderada", () => {
  it("média simples: 7 e 6 dão 6,5; 5,9 + 6,0 não vira 5,9999", () => {
    expect(summarizeGrades(base, [item("P1", 700), item("P2", 600)])).toMatchObject({
      final: 650,
      status: "aprovado_por_nota",
    });
    const s = summarizeGrades(base, [item("P1", 590), item("P2", 610)]);
    expect(s.final).toBe(600);
    expect(s.status).toBe("aprovado_por_nota");
  });

  it("ponderada 40/60 com uma prova lançada: garantida, parcial, máxima e quanto falta", () => {
    const rules = { ...base, formula: "0.4*P1 + 0.6*P2" };
    const s = summarizeGrades(rules, [item("P1", 500), item("P2", null)]);
    expect(s).toMatchObject({
      guaranteed: 200, // 0,4 × 5
      partial: 500, // só a P1 conta, proporcional
      maxPossible: 800, // 0,4×5 + 0,6×10
      final: null,
      status: "em_curso",
    });
    // 0,4×5 + 0,6×x ≥ 6  →  x ≥ 6,67
    expect(s.needed?.items).toEqual([{ key: "P2", name: "P2", needed: 667, maxScore: 1000 }]);
  });

  it("fórmula do professor: (2*P1 + 3*P2)/5 + Trabalho", () => {
    const rules = { ...base, formula: "(2*P1 + 3*P2)/5 + Trabalho" };
    const s = summarizeGrades(rules, [
      item("P1", 600),
      item("P2", 500),
      item("Trabalho", 100, { maxScore: 200 }),
    ]);
    expect(s.final).toBe(640); // (12+15)/5 + 1
  });

  it("soma de pontos até 100", () => {
    const rules: GradingRules = { ...base, scale: 100, passing: 6000, formula: "A1 + A2 + A3" };
    const s = summarizeGrades(rules, [
      item("A1", 2500, { maxScore: 3000 }),
      item("A2", null, { maxScore: 3000 }),
      item("A3", null, { maxScore: 4000 }),
    ]);
    expect(s).toMatchObject({ guaranteed: 2500, maxPossible: 9500, status: "em_curso" });
    // Precisa de 35 dos 70 restantes: metade de cada.
    expect(s.needed?.items.map((i) => i.needed)).toEqual([1500, 2000]);
  });
});

describe("grupos, substitutiva, exame e arredondamento", () => {
  it("listas com descarte da pior", () => {
    const rules: GradingRules = {
      ...base,
      formula: "0.7*P1 + 0.3*Listas",
      groups: [{ key: "Listas", name: "Listas", aggregate: "mean", dropLowest: 1 }],
    };
    const s = summarizeGrades(rules, [
      item("P1", 600),
      item("L1", 1000, { group: "Listas" }),
      item("L2", 200, { group: "Listas" }),
      item("L3", 800, { group: "Listas" }),
    ]);
    expect(s.final).toBe(690); // 4,2 + 0,3 × média(10, 8)
  });

  it("substitutiva troca a menor prova só se for maior", () => {
    const rules: GradingRules = { ...base, substitute: { replaces: ["P1", "P2"] } };
    const items = [item("P1", 300), item("P2", 800), item("Sub", 700, { role: "substitute" })];
    expect(summarizeGrades(rules, items).final).toBe(750);
    const worse = [item("P1", 300), item("P2", 800), item("Sub", 200, { role: "substitute" })];
    expect(summarizeGrades(rules, worse).final).toBe(550);
  });

  it("exame: entre 4 e 6 vai para exame; (MEDIA + EXAME)/2 ≥ 5", () => {
    const rules: GradingRules = {
      ...base,
      exam: { minToTake: 400, formula: "(MEDIA + EXAME) / 2", passing: 500 },
    };
    const s = summarizeGrades(rules, [item("P1", 500), item("P2", 400)]);
    expect(s).toMatchObject({ final: 450, status: "em_exame", neededOnExam: 550 });
    const after = summarizeGrades(rules, [
      item("P1", 500),
      item("P2", 400),
      item("Exame", 600, { role: "exam" }),
    ]);
    expect(after).toMatchObject({ afterExam: 525, status: "aprovado_por_nota" });
    expect(summarizeGrades(rules, [item("P1", 300), item("P2", 300)]).status).toBe(
      "reprovado_por_nota",
    );
    // Sem as provas lançadas, mas sem chance direta: só pelo exame.
    const rulesTight = { ...rules, formula: "0.9*P1 + 0.1*P2" };
    expect(summarizeGrades(rulesTight, [item("P1", 500), item("P2", null)]).status).toBe(
      "sem_chance_direta",
    );
  });

  it("sem arredondamento corta nos centésimos (5,996 não vira 6)", () => {
    const rules = { ...base, formula: "0.4*P1 + 0.6*P2" };
    expect(summarizeGrades(rules, [item("P1", 500), item("P2", 666)])).toMatchObject({
      final: 599,
      status: "reprovado_por_nota",
    });
  });

  it("arredonda para 0,5 (meio para cima)", () => {
    const rules = { ...base, roundingStep: 50 };
    expect(summarizeGrades(rules, [item("P1", 575), item("P2", 600)]).final).toBe(600); // 5,875 → 6
    expect(summarizeGrades(rules, [item("P1", 540), item("P2", 600)]).final).toBe(550); // 5,7 → 5,5
  });

  it("simulação: e se eu tirar 8 na P2?", () => {
    const s = simulateGrades(base, [item("P1", 500), item("P2", null)], { P2: 800 });
    expect(s).toMatchObject({ final: 650, status: "aprovado_por_nota" });
  });
});

describe("validação", () => {
  it("aponta nome desconhecido, exame errado, mínima fora da escala e divisão por zero", () => {
    const items = [item("P1", null), item("P2", null)];
    expect(validateGrading(base, items)).toEqual([]);
    // Sem o campo score (como chega da API ao salvar a regra) também valida.
    expect(
      validateGrading(
        { ...base, formula: "0.4*P1 + 0.6*P2" },
        items.map(({ score: _s, ...rest }) => rest),
      ),
    ).toEqual([]);
    expect(validateGrading({ ...base, formula: "P1 + P3" }, items)).toEqual([
      { path: "formula", message: '"P3" não é uma avaliação nem um grupo.' },
    ]);
    expect(validateGrading({ ...base, passing: 1100 }, items)[0]?.path).toBe("passing");
    expect(
      validateGrading(
        { ...base, exam: { minToTake: 400, formula: "MEDIA + P1", passing: 500 } },
        items,
      )[0],
    ).toMatchObject({ path: "exam.formula" });
    expect(validateGrading({ ...base, formula: "P1 / (P2 - P2)" }, items)).toEqual([
      { path: "formula", message: "A fórmula divide por zero." },
    ]);
    expect(validateGrading(base, [item("P 1", null)])[0]?.path).toBe("items.0.key");
  });
});

describe("propriedades", () => {
  const score = fc.integer({ min: 0, max: 1000 });
  const weight = fc.integer({ min: 1, max: 9 });

  it("média ponderada: exata, entre a menor e a maior nota, e nunca passa de 10", () => {
    fc.assert(
      fc.property(score, score, weight, weight, (a, b, wa, wb) => {
        const rules = { ...base, formula: `(${wa}*P1 + ${wb}*P2) / ${wa + wb}` };
        const s = summarizeGrades(rules, [item("P1", a), item("P2", b)]);
        const exact = (wa * a + wb * b) / (wa + wb);
        expect(s.final).toBe(Math.floor(exact + 1e-9)); // sem arredondamento: corta nos centésimos
        expect(s.final!).toBeGreaterThanOrEqual(Math.min(a, b));
        expect(s.final!).toBeLessThanOrEqual(Math.max(a, b));
      }),
    );
  });

  it("subir uma nota nunca baixa a média; garantida ≤ máxima", () => {
    fc.assert(
      fc.property(score, score, fc.integer({ min: 0, max: 200 }), (a, b, bump) => {
        const rules = { ...base, formula: "0.4*P1 + 0.6*P2" };
        const lower = summarizeGrades(rules, [item("P1", a), item("P2", b)]).final!;
        const higher = summarizeGrades(rules, [
          item("P1", Math.min(1000, a + bump)),
          item("P2", b),
        ]).final!;
        expect(higher).toBeGreaterThanOrEqual(lower);
        const partial = summarizeGrades(rules, [item("P1", a), item("P2", null)]);
        expect(partial.guaranteed).toBeLessThanOrEqual(partial.maxPossible);
      }),
    );
  });

  it("tirar o que o 'quanto falta' diz faz passar (e 0,01 a menos não)", () => {
    fc.assert(
      fc.property(score, weight, weight, (a, wa, wb) => {
        const rules = { ...base, formula: `(${wa}*P1 + ${wb}*P2) / ${wa + wb}` };
        const items = [item("P1", a), item("P2", null)];
        const s = summarizeGrades(rules, items);
        if (!s.needed) return;
        const need = s.needed.items[0]!.needed;
        expect(simulateGrades(rules, items, { P2: need }).final!).toBeGreaterThanOrEqual(600);
        if (need > 0) {
          expect(simulateGrades(rules, items, { P2: need - 1 }).final!).toBeLessThan(600);
        }
      }),
    );
  });
});

describe("formato", () => {
  it("formata e lê notas em pt-BR", () => {
    expect([formatGrade(700), formatGrade(750), formatGrade(725), formatGrade(5)]).toEqual([
      "7",
      "7,5",
      "7,25",
      "0,05",
    ]);
    expect([parseGrade("7,5"), parseGrade("7.25"), parseGrade("10"), parseGrade("x")]).toEqual([
      750,
      725,
      1000,
      null,
    ]);
  });
});
