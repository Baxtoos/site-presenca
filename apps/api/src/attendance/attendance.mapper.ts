import type { AttendanceRecord } from "@presenca/contracts";
import type { schema } from "@presenca/db";

export type AttendanceRow = typeof schema.attendanceLogs.$inferSelect;

export function toRecord(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    scheduleId: row.scheduleId,
    classDate: row.classDate,
    status: row.status,
    unitsScheduled: row.unitsScheduled,
    unitsMissed: row.unitsMissed,
    isExcused: row.isExcused,
    reason: row.reason,
    note: row.note,
    version: row.version,
  };
}

export const brDate = (iso: string) => iso.split("-").reverse().join("/");

export type Status = AttendanceRow["status"];

/**
 * Tempos perdidos a partir do status. Falta total perde todos os tempos da aula; parcial perde só
 * os informados; presença e aula cancelada não perdem nada.
 */
export function missedFor(
  status: Status,
  scheduled: number,
  partialMissed: number | undefined,
): number {
  switch (status) {
    case "absent":
      return scheduled;
    case "partial":
      return partialMissed ?? 0;
    default:
      return 0;
  }
}

/** Atestado e motivo só fazem sentido numa falta (total ou parcial). */
export const countsAsAbsence = (status: Status) => status === "absent" || status === "partial";
