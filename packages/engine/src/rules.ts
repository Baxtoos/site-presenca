/**
 * Regras de contagem → T (total de tempos) e F (limite de faltas).
 *
 * Tudo é convertido para "tempos de chamada" e calculado só com inteiros:
 * ponto flutuante faria, por exemplo, 40 × (1 − 0,8) = 7,999… e o piso viraria 7.
 * O limite de faltas é sempre arredondado para baixo (a favor do aluno).
 */

/** 100% em centésimos de ponto percentual (basis points). 75% = 7500. */
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
      /** Carga horária; aceita até 2 casas decimais (ex.: 67,5). */
      workloadHours: number;
      /** 60 para hora-relógio; 50 ou 45 para hora-aula. */
      workloadHourMinutes: number;
      /** Duração de 1 tempo de chamada, em minutos. */
      unitMinutes: number;
      unitsPerClass: number;
      minAttendanceBp: number;
    }
  | {
      mode: "manual";
      manualMaxUnits: number;
      unitsPerClass: number;
      /** Opcional: permite calcular a presença projetada. */
      totalClasses?: number;
    };

export function requireInt(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} precisa ser um inteiro ≥ ${min} (recebido: ${value})`);
  }
}

/** Valida as regras antes de qualquer conta. Lança RangeError com o campo inválido. */
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

/**
 * Minutos totais da carga, só com inteiros: 33,3 h × 60 daria 1997,999… em ponto flutuante.
 * As horas viram centésimos de hora antes da multiplicação.
 */
export function workloadMinutes(hours: number, hourMinutes: number): number {
  const centiHours = Math.round(hours * 100);
  return Math.floor((centiHours * hourMinutes) / 100);
}

/** T: total de tempos de chamada no semestre. Retorna null quando não dá para saber. */
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

/** F: máximo de tempos que podem ser perdidos, sempre arredondado para baixo. */
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
