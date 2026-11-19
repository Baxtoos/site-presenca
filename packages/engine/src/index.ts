/**
 * Motor de cálculo acadêmico: puro, sem I/O, sem dependências.
 * A API usa como fonte oficial dos números; o web usa só para a prévia enquanto o aluno digita.
 */
export {
  FULL_BP,
  maxAbsenceUnits,
  totalUnits,
  validateRules,
  workloadMinutes,
  type CountingMode,
  type SubjectRules,
} from "./rules";
export {
  consumptionPct,
  presencePct,
  projectedPresence,
  RISK_ORDER,
  riskLevel,
  type Risk,
} from "./risk";
export { summarize, type AttendanceTotals, type SubjectSummary } from "./summary";
export {
  addDays,
  classOccurrences,
  isoWeekday,
  planSkips,
  type CalendarException,
  type ClassOccurrence,
  type IsoDate,
  type ScheduleSlot,
  type SkipPlan,
} from "./calendar";
export {
  evaluateThresholds,
  THRESHOLDS,
  type ThresholdEvaluation,
  type ThresholdPct,
  type ThresholdState,
} from "./thresholds";
export { brazilHolidays, brazilHolidaysBetween, easterSunday, type Holiday } from "./holidays";
