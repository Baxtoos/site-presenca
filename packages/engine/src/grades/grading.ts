import { evaluate, type Expr, FormulaError, formulaRefs, type Ops, parseFormula } from "./formula";
import {
  add,
  cmp,
  div,
  fromCenti,
  max,
  min,
  mul,
  rat,
  type Rational,
  roundRational,
  sub,
  ZERO,
} from "./rational";

/**
 * Regra de cálculo da nota de uma matéria, do jeito que o professor quiser: escala, nota mínima,
 * fórmula sobre as avaliações (ou grupos), grupos com descarte das piores, substitutiva e exame.
 * Todas as notas em centésimos de ponto (7,5 → 750), contas em frações exatas.
 */
export interface GradeGroup {
  key: string;
  name: string;
  /** mean: média das notas do grupo; sum: soma. */
  aggregate: "mean" | "sum";
  /** Quantas das piores notas do grupo descartar. */
  dropLowest: number;
}

export interface GradingRules {
  scale: 10 | 100;
  /** Nota mínima para passar, em centésimos (6,0 → 600). */
  passing: number;
  /** Fórmula sobre as chaves das avaliações e dos grupos. */
  formula: string;
  groups: GradeGroup[];
  /** Exame/prova final: quem fica entre minToTake e a nota mínima faz o exame. */
  exam: { minToTake: number; formula: string; passing: number } | null;
  /** Substitutiva: troca a menor nota entre estas avaliações, se for maior. */
  substitute: { replaces: string[] } | null;
  /** Arredondamento da nota final, em centésimos (1 = nenhum, 10 = 0,1, 50 = 0,5). */
  roundingStep: number;
}

export interface EvaluationItem {
  key: string;
  name: string;
  /** Nota máxima da avaliação, em centésimos. */
  maxScore: number;
  /** Grupo (ex.: listas) ou null. */
  group: string | null;
  role: "regular" | "substitute" | "exam";
  /** Nota lançada, em centésimos; null = ainda não saiu. */
  score: number | null;
}

export type GradeStatus =
  "aprovado_por_nota" | "em_curso" | "em_exame" | "sem_chance_direta" | "reprovado_por_nota";

export interface GradeSummary {
  /** Nota contando o que falta como zero. */
  guaranteed: number;
  /** Média proporcional ao que já foi avaliado (null se nada foi avaliado). */
  partial: number | null;
  /** Maior nota possível tirando nota máxima no que falta. */
  maxPossible: number;
  /** Nota final (todas as avaliações lançadas), antes do exame. */
  final: number | null;
  /** Nota depois do exame, se o exame foi lançado. */
  afterExam: number | null;
  /** O que falta tirar, em cada avaliação pendente, para chegar à nota mínima. */
  needed: { items: { key: string; name: string; needed: number; maxScore: number }[] } | null;
  /** Nota mínima no exame para passar (quando cabe). */
  neededOnExam: number | null;
  status: GradeStatus;
  /** Avaliações lançadas / total (sem substitutiva e exame). */
  graded: number;
  total: number;
}

export class GradingError extends Error {
  override name = "GradingError";
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
  }
}

const KEY = /^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]{0,29}$/;
const EXAM_REFS = new Set(["media", "exame"]);
const norm = (s: string) => s.toLowerCase();

const OPS: Ops = { zero: ZERO, int: (n) => rat(n), add, sub, mul, div, min, max };

/** Confere a regra e as avaliações; devolve os problemas (vazio = válida). */
export function validateGrading(
  rules: GradingRules,
  items: Omit<EvaluationItem, "score">[],
): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const scaleMax = rules.scale * 100;
  if (rules.passing <= 0 || rules.passing > scaleMax) {
    errors.push({
      path: "passing",
      message: `A nota mínima precisa estar entre 0 e ${rules.scale}.`,
    });
  }
  const keys = new Set<string>();
  items.forEach((it, i) => {
    if (!KEY.test(it.key)) {
      errors.push({
        path: `items.${i}.key`,
        message: "Use um nome curto, sem espaços (ex.: P1, Lista2, Trabalho).",
      });
    }
    if (keys.has(norm(it.key))) errors.push({ path: `items.${i}.key`, message: "Nome repetido." });
    keys.add(norm(it.key));
    if (it.maxScore <= 0 || it.maxScore > scaleMax) {
      errors.push({
        path: `items.${i}.maxScore`,
        message: `A nota máxima vai de 0 a ${rules.scale}.`,
      });
    }
    if (it.group && !rules.groups.some((g) => norm(g.key) === norm(it.group!))) {
      errors.push({ path: `items.${i}.group`, message: "Grupo não existe." });
    }
  });
  rules.groups.forEach((g, i) => {
    if (!KEY.test(g.key)) errors.push({ path: `groups.${i}.key`, message: "Nome inválido." });
    if (keys.has(norm(g.key))) {
      errors.push({ path: `groups.${i}.key`, message: "Mesmo nome de uma avaliação." });
    }
    if (g.dropLowest < 0 || g.dropLowest > 20) {
      errors.push({ path: `groups.${i}.dropLowest`, message: "Descarte de 0 a 20." });
    }
  });
  const known = new Set([...keys, ...rules.groups.map((g) => norm(g.key))]);
  const regular = new Set(items.filter((i) => i.role === "regular").map((i) => norm(i.key)));
  const groupKeys = new Set(rules.groups.map((g) => norm(g.key)));
  try {
    const refs = formulaRefs(parseFormula(rules.formula));
    for (const r of refs) {
      if (!known.has(norm(r))) {
        errors.push({ path: "formula", message: `"${r}" não é uma avaliação nem um grupo.` });
      } else if (!regular.has(norm(r)) && !groupKeys.has(norm(r))) {
        errors.push({
          path: "formula",
          message: `"${r}" é substitutiva ou exame: não entra na fórmula da média.`,
        });
      }
    }
    if (refs.size === 0)
      errors.push({ path: "formula", message: "A fórmula não usa nenhuma nota." });
  } catch (e) {
    if (e instanceof FormulaError) errors.push({ path: "formula", message: e.message });
    else throw e;
  }
  if (rules.exam) {
    try {
      for (const r of formulaRefs(parseFormula(rules.exam.formula))) {
        if (!EXAM_REFS.has(norm(r))) {
          errors.push({ path: "exam.formula", message: `Use só MEDIA e EXAME (não "${r}").` });
        }
      }
    } catch (e) {
      if (e instanceof FormulaError) errors.push({ path: "exam.formula", message: e.message });
      else throw e;
    }
    if (rules.exam.minToTake < 0 || rules.exam.minToTake >= rules.passing) {
      errors.push({
        path: "exam.minToTake",
        message: "A nota para ter direito ao exame precisa ser menor que a mínima para passar.",
      });
    }
  }
  if (rules.substitute) {
    for (const k of rules.substitute.replaces) {
      if (!regular.has(norm(k))) {
        errors.push({
          path: "substitute.replaces",
          message: `"${k}" não é uma avaliação regular.`,
        });
      }
    }
    if (!items.some((i) => i.role === "substitute")) {
      errors.push({ path: "substitute", message: "Cadastre a avaliação substitutiva." });
    }
  }
  if (![1, 5, 10, 25, 50, 100].includes(rules.roundingStep)) {
    errors.push({ path: "roundingStep", message: "Arredondamento inválido." });
  }
  if (errors.length === 0) {
    // Teste de conta: tudo no máximo não pode dividir por zero.
    try {
      evalScenario(prepare(rules, items as EvaluationItem[]), (it) => fromCenti(it.maxScore));
    } catch {
      errors.push({ path: "formula", message: "A fórmula divide por zero." });
    }
  }
  return errors;
}

interface Prepared {
  rules: GradingRules;
  tree: Expr;
  examTree: Expr | null;
  regular: EvaluationItem[];
  substitute: EvaluationItem | null;
  exam: EvaluationItem | null;
}

function prepare(rules: GradingRules, items: EvaluationItem[]): Prepared {
  return {
    rules,
    tree: parseFormula(rules.formula),
    examTree: rules.exam ? parseFormula(rules.exam.formula) : null,
    regular: items.filter((i) => i.role === "regular"),
    substitute: items.find((i) => i.role === "substitute") ?? null,
    exam: items.find((i) => i.role === "exam") ?? null,
  };
}

/** Valor da fórmula num cenário (como preencher as notas que faltam). */
function evalScenario(p: Prepared, missing: (it: EvaluationItem) => Rational): Rational {
  const values = new Map<string, Rational>();
  for (const it of p.regular) {
    values.set(norm(it.key), it.score === null ? missing(it) : fromCenti(it.score));
  }
  // Substitutiva: troca a menor das avaliações indicadas, se for maior.
  if (p.substitute?.score != null && p.rules.substitute) {
    const subScore = fromCenti(p.substitute.score);
    let lowest: string | null = null;
    for (const k of p.rules.substitute.replaces.map(norm)) {
      const v = values.get(k);
      if (v && (lowest === null || cmp(v, values.get(lowest)!) < 0)) lowest = k;
    }
    if (lowest && cmp(subScore, values.get(lowest)!) > 0) values.set(lowest, subScore);
  }
  const groups = new Map<string, Rational>();
  for (const g of p.rules.groups) {
    const members = p.regular
      .filter((it) => it.group && norm(it.group) === norm(g.key))
      .map((it) => values.get(norm(it.key))!)
      .sort(cmp)
      .slice(g.dropLowest);
    if (members.length === 0) {
      groups.set(norm(g.key), ZERO);
      continue;
    }
    const total = members.reduce(add, ZERO);
    groups.set(norm(g.key), g.aggregate === "sum" ? total : div(total, rat(members.length)));
  }
  return evaluate(p.tree, (name) => values.get(norm(name)) ?? groups.get(norm(name)) ?? ZERO, OPS);
}

const rounded = (p: Prepared, r: Rational) => {
  const scaleMax = p.rules.scale * 100;
  return Math.max(0, Math.min(scaleMax, roundRational(r, p.rules.roundingStep)));
};

function examResult(p: Prepared, media: number, exam: number): number {
  const r = evaluate(
    p.examTree!,
    (name) => (norm(name) === "media" ? fromCenti(media) : fromCenti(exam)),
    OPS,
  );
  return rounded(p, r);
}

/** Resumo da nota: garantida, parcial, máxima, quanto falta e situação. */
export function summarizeGrades(rules: GradingRules, items: EvaluationItem[]): GradeSummary {
  const p = prepare(rules, items);
  const graded = p.regular.filter((i) => i.score !== null).length;
  const total = p.regular.length;
  const guaranteedR = evalScenario(p, () => ZERO);
  const guaranteed = rounded(p, guaranteedR);
  const maxPossible = rounded(
    p,
    evalScenario(p, (it) => fromCenti(it.maxScore)),
  );

  // Parcial: o que já tirou dividido pelo máximo que dava para tirar no que já foi avaliado.
  let partial: number | null = null;
  if (graded > 0) {
    const evaluatedMax = evalScenario(
      {
        ...p,
        regular: p.regular.map((it) => (it.score === null ? it : { ...it, score: it.maxScore })),
      },
      () => ZERO,
    );
    if (evaluatedMax.n > 0n) {
      partial = rounded(p, mul(div(guaranteedR, evaluatedMax), rat(rules.scale)));
    }
  }

  const final = graded === total && total > 0 ? guaranteed : null;
  const examMax = p.exam?.maxScore ?? rules.scale * 100;
  const canExam = (media: number) =>
    rules.exam !== null && media >= rules.exam.minToTake && media < rules.passing;
  const neededOnExamFor = (media: number): number | null => {
    if (!rules.exam || !p.examTree) return null;
    if (examResult(p, media, examMax) < rules.exam.passing) return null;
    let lo = 0;
    let hi = examMax;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (examResult(p, media, mid) >= rules.exam.passing) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  // Quanto falta: a menor fração f das notas máximas, igual em todas as pendentes, que passa.
  let needed: GradeSummary["needed"] = null;
  if (final === null && guaranteed < rules.passing && maxPossible >= rules.passing) {
    const pass = (bp: number) =>
      rounded(
        p,
        evalScenario(p, (it) => div(mul(fromCenti(it.maxScore), rat(bp)), rat(10_000))),
      ) >= rules.passing;
    let lo = 0;
    let hi = 10_000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (pass(mid)) hi = mid;
      else lo = mid + 1;
    }
    needed = {
      items: p.regular
        .filter((it) => it.score === null)
        .map((it) => ({
          key: it.key,
          name: it.name,
          needed: Math.ceil((it.maxScore * lo) / 10_000),
          maxScore: it.maxScore,
        })),
    };
  }

  let status: GradeStatus;
  let afterExam: number | null = null;
  let neededOnExam: number | null = null;
  if (final !== null) {
    if (final >= rules.passing) status = "aprovado_por_nota";
    else if (canExam(final)) {
      if (p.exam?.score != null) {
        afterExam = examResult(p, final, p.exam.score);
        status = afterExam >= rules.exam!.passing ? "aprovado_por_nota" : "reprovado_por_nota";
      } else {
        neededOnExam = neededOnExamFor(final);
        status = neededOnExam === null ? "reprovado_por_nota" : "em_exame";
      }
    } else status = "reprovado_por_nota";
  } else if (guaranteed >= rules.passing) status = "aprovado_por_nota";
  else if (maxPossible >= rules.passing) status = "em_curso";
  else if (
    rules.exam &&
    maxPossible >= rules.exam.minToTake &&
    neededOnExamFor(maxPossible) !== null
  ) {
    status = "sem_chance_direta";
  } else status = "reprovado_por_nota";

  return {
    guaranteed,
    partial,
    maxPossible,
    final,
    afterExam,
    needed,
    neededOnExam,
    status,
    graded,
    total,
  };
}

/** Simula: a mesma conta com notas hipotéticas (o navegador usa para "e se eu tirar X?"). */
export function simulateGrades(
  rules: GradingRules,
  items: EvaluationItem[],
  hypothetical: Record<string, number>,
): GradeSummary {
  return summarizeGrades(
    rules,
    items.map((it) =>
      it.score === null && hypothetical[it.key] !== undefined
        ? { ...it, score: hypothetical[it.key]! }
        : it,
    ),
  );
}

/** "7,5" a partir de 750 (sem zeros sobrando: 700 → "7", 725 → "7,25"). */
export function formatGrade(centi: number): string {
  const whole = Math.trunc(centi / 100);
  const frac = Math.abs(centi % 100);
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** "7,5" ou "7.5" → 750 (null se inválido). */
export function parseGrade(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
