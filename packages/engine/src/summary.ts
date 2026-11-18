import { consumptionPct, presencePct, type Risk, riskLevel } from "./risk";
import { maxAbsenceUnits, type SubjectRules, totalUnits } from "./rules";

/** Totais vindos do banco (view subject_totals): sempre derivados dos registros. */
export interface AttendanceTotals {
  /** Tempos perdidos que contam para o limite (atestado conta se a política for track_only). */
  unitsCounted: number;
  /** Tempos perdidos com atestado (contem ou não para o limite). */
  unitsExcused: number;
  /** Tempos de aulas que já aconteceram (sem as canceladas). */
  unitsHeld: number;
}

export interface SubjectSummary {
  /** T, ou null quando a matéria não informa o total (limite manual sem total de aulas). */
  totalUnits: number | null;
  /** F */
  maxAbsenceUnits: number;
  /** A */
  absentUnits: number;
  excusedUnits: number;
  heldUnits: number;
  /** F − A (negativo quando passou do limite). */
  remainingUnits: number;
  /** Encontros inteiros que ainda cabem no saldo. */
  remainingClasses: number;
  /** Tempos acima do limite (0 se não passou). */
  exceededBy: number;
  consumptionPct: number;
  risk: Risk;
  /** Presença final se o aluno for a todas as aulas restantes; null sem T. */
  projectedPresencePct: number | null;
  /** Presença nas aulas que já aconteceram; null se nenhuma aconteceu. */
  presenceSoFarPct: number | null;
}

/** Junta as regras da matéria com os totais registrados: tudo que o card da matéria mostra. */
export function summarize(rules: SubjectRules, totals: AttendanceTotals): SubjectSummary {
  const T = totalUnits(rules);
  const F = maxAbsenceUnits(rules);
  const A = totals.unitsCounted;
  const R = F - A;
  return {
    totalUnits: T,
    maxAbsenceUnits: F,
    absentUnits: A,
    excusedUnits: totals.unitsExcused,
    heldUnits: totals.unitsHeld,
    remainingUnits: R,
    remainingClasses: Math.floor(Math.max(0, R) / rules.unitsPerClass),
    exceededBy: Math.max(0, -R),
    consumptionPct: consumptionPct(A, F),
    risk: riskLevel(A, F, rules.unitsPerClass),
    projectedPresencePct: T === null ? null : presencePct(T, Math.min(A, T)),
    presenceSoFarPct:
      totals.unitsHeld > 0 ? presencePct(totals.unitsHeld, Math.min(A, totals.unitsHeld)) : null,
  };
}
