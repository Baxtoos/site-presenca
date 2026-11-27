import { consumptionPct, presencePct, type Risk, riskLevel } from "./risk";
import { maxAbsenceUnits, type SubjectRules, totalUnits } from "./rules";

export interface AttendanceTotals {
  unitsCounted: number;
  unitsExcused: number;
  unitsHeld: number;
}

export interface SubjectSummary {
  totalUnits: number | null;
  maxAbsenceUnits: number;
  absentUnits: number;
  excusedUnits: number;
  heldUnits: number;
  remainingUnits: number;
  remainingClasses: number;
  exceededBy: number;
  consumptionPct: number;
  risk: Risk;
  projectedPresencePct: number | null;
  presenceSoFarPct: number | null;
}

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
