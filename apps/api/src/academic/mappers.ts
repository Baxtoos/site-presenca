import type {
  CalendarExceptionDto,
  ScheduleBody,
  Schedule,
  Semester,
  Subject,
  SubjectBody,
} from "@presenca/contracts";
import type { schema } from "@presenca/db";
import { type AttendanceTotals, type SubjectRules, summarize } from "@presenca/engine";

type SemesterRow = typeof schema.semesters.$inferSelect;
type SubjectRow = typeof schema.subjects.$inferSelect;
type ScheduleRow = typeof schema.subjectSchedules.$inferSelect;
type ExceptionRow = typeof schema.calendarExceptions.$inferSelect;

export const NO_ATTENDANCE: AttendanceTotals = { unitsCounted: 0, unitsExcused: 0, unitsHeld: 0 };

export function toSemester(row: SemesterRow, subjectsCount: number): Semester {
  return {
    id: row.id,
    label: row.label,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    isCurrent: row.isCurrent,
    subjectsCount,
    version: row.version,
  };
}

/** O Postgres devolve time como "19:00:00"; a API fala "19:00". */
const hhmm = (time: string) => time.slice(0, 5);

export function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    weekday: row.weekday,
    startsAt: hhmm(row.startsAt),
    endsAt: hhmm(row.endsAt),
    units: row.units,
    room: row.room,
    building: row.building,
    professor: row.professor,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    version: row.version,
  };
}

/** Regras gravadas → regras do motor. numeric vem do driver como string. */
export function rulesFromRow(row: SubjectRow): SubjectRules {
  switch (row.countingMode) {
    case "class_count":
      return {
        mode: "class_count",
        totalClasses: row.totalClasses!,
        unitsPerClass: row.unitsPerClass,
        minAttendanceBp: row.minAttendanceBp,
      };
    case "workload":
      return {
        mode: "workload",
        workloadHours: Number(row.workloadHours),
        workloadHourMinutes: row.workloadHourMinutes!,
        unitMinutes: row.unitMinutes!,
        unitsPerClass: row.unitsPerClass,
        minAttendanceBp: row.minAttendanceBp,
      };
    case "manual":
      return {
        mode: "manual",
        manualMaxUnits: row.manualMaxUnits!,
        unitsPerClass: row.unitsPerClass,
        ...(row.totalClasses === null ? {} : { totalClasses: row.totalClasses }),
      };
  }
}

export function toSubject(
  row: SubjectRow,
  schedules: ScheduleRow[],
  totals: AttendanceTotals,
  gradeStatus: Subject["gradeStatus"] = null,
): Subject {
  return {
    id: row.id,
    semesterId: row.semesterId,
    name: row.name,
    code: row.code,
    professor: row.professor,
    color: (row.color as Subject["color"]) ?? null,
    countingMode: row.countingMode,
    totalClasses: row.totalClasses,
    unitsPerClass: row.unitsPerClass,
    workloadHours: row.workloadHours === null ? null : Number(row.workloadHours),
    workloadHourMinutes: row.workloadHourMinutes,
    unitMinutes: row.unitMinutes,
    minAttendanceBp: row.minAttendanceBp,
    manualMaxUnits: row.manualMaxUnits,
    excusedPolicy: row.excusedPolicy,
    version: row.version,
    schedules: schedules.map(toSchedule),
    summary: summarize(rulesFromRow(row), totals),
    gradeStatus,
  };
}

/**
 * Corpo da requisição → colunas da matéria. Os campos de outros modos de contagem vão como null,
 * para que trocar o modo (ex.: de carga horária para aulas) não deixe lixo para trás.
 */
export function subjectColumns(body: SubjectBody) {
  const common = {
    name: body.name,
    code: body.code ?? null,
    professor: body.professor ?? null,
    color: body.color ?? null,
    unitsPerClass: body.unitsPerClass,
    excusedPolicy: body.excusedPolicy,
    totalClasses: null as number | null,
    workloadHours: null as string | null,
    workloadHourMinutes: null as number | null,
    unitMinutes: null as number | null,
    manualMaxUnits: null as number | null,
  };
  switch (body.countingMode) {
    case "class_count":
      return {
        ...common,
        countingMode: "class_count" as const,
        totalClasses: body.totalClasses,
        minAttendanceBp: body.minAttendanceBp,
      };
    case "workload":
      return {
        ...common,
        countingMode: "workload" as const,
        workloadHours: body.workloadHours.toFixed(2),
        workloadHourMinutes: body.workloadHourMinutes,
        unitMinutes: body.unitMinutes,
        minAttendanceBp: body.minAttendanceBp,
      };
    case "manual":
      return {
        ...common,
        countingMode: "manual" as const,
        manualMaxUnits: body.manualMaxUnits,
        totalClasses: body.totalClasses ?? null,
        // Sem efeito no limite manual; guarda o padrão para o caso de trocar de modo depois.
        minAttendanceBp: 7500,
      };
  }
}

export function scheduleColumns(body: ScheduleBody) {
  return {
    weekday: body.weekday,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    units: body.units,
    room: body.room ?? null,
    building: body.building ?? null,
    professor: body.professor ?? null,
    validFrom: body.validFrom ?? null,
    validUntil: body.validUntil ?? null,
  };
}

export function toException(row: ExceptionRow): CalendarExceptionDto {
  return {
    id: row.id,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    kind: row.kind,
    label: row.label,
    subjectId: row.subjectId,
  };
}
