export const FULL_BP = 10_000;

export type CountingMode = "class_count" | "workload" | "manual";

export type SubjectRules =
  | {
      mode: "class_count";
      totalClasses: number;
      unitsPerClass: number;
      minAttendanceBp: number;
    }
  | {
      mode: "workload";
      workloadHours: number;
      workloadHourMinutes: number;
      unitMinutes: number;
      unitsPerClass: number;
      minAttendanceBp: number;
    }
  | {
      mode: "manual";
      manualMaxUnits: number;
      unitsPerClass: number;
      totalClasses?: number;
    };

export function requireInt(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} precisa ser um inteiro ≥ ${min} (recebido: ${value})`);
  }
}

export function validateRules(rules: SubjectRules): void {
  requireInt("unitsPerClass", rules.unitsPerClass, 1);
  switch (rules.mode) {
    case "class_count":
      requireInt("totalClasses", rules.totalClasses, 0);
      requireInt("minAttendanceBp", rules.minAttendanceBp, 0);
      break;
    case "workload":
      if (!Number.isFinite(rules.workloadHours) || rules.workloadHours <= 0) {
        throw new RangeError(`workloadHours precisa ser > 0 (recebido: ${rules.workloadHours})`);
      }
      requireInt("workloadHourMinutes", rules.workloadHourMinutes, 1);
      requireInt("unitMinutes", rules.unitMinutes, 1);
      requireInt("minAttendanceBp", rules.minAttendanceBp, 0);
      break;
    case "manual":
      requireInt("manualMaxUnits", rules.manualMaxUnits, 0);
      if (rules.totalClasses !== undefined) requireInt("totalClasses", rules.totalClasses, 0);
      return;
  }
  if (rules.minAttendanceBp > FULL_BP) {
    throw new RangeError(`minAttendanceBp precisa estar entre 0 e ${FULL_BP}`);
  }
}

export function workloadMinutes(hours: number, hourMinutes: number): number {
  const centiHours = Math.round(hours * 100);
  return Math.floor((centiHours * hourMinutes) / 100);
}

export function totalUnits(rules: SubjectRules): number | null {
  validateRules(rules);
  switch (rules.mode) {
    case "class_count":
      return rules.totalClasses * rules.unitsPerClass;
    case "workload":
      return Math.floor(
        workloadMinutes(rules.workloadHours, rules.workloadHourMinutes) / rules.unitMinutes,
      );
    case "manual":
      return rules.totalClasses === undefined ? null : rules.totalClasses * rules.unitsPerClass;
  }
}

export function maxAbsenceUnits(rules: SubjectRules): number {
  validateRules(rules);
  switch (rules.mode) {
    case "class_count": {
      const allowedBp = FULL_BP - rules.minAttendanceBp;
      return Math.floor((rules.totalClasses * rules.unitsPerClass * allowedBp) / FULL_BP);
    }
    case "workload": {
      const minutes = workloadMinutes(rules.workloadHours, rules.workloadHourMinutes);
      const allowedBp = FULL_BP - rules.minAttendanceBp;
      return Math.floor((minutes * allowedBp) / (FULL_BP * rules.unitMinutes));
    }
    case "manual":
      return rules.manualMaxUnits;
  }
}
