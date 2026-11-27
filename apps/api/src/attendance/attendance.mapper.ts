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
    content: row.content,
    version: row.version,
  };
}

export const brDate = (iso: string) => iso.split("-").reverse().join("/");

export type Status = AttendanceRow["status"];

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

export const countsAsAbsence = (status: Status) => status === "absent" || status === "partial";
