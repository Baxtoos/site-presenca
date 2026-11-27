import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, ownerId, pk, updatedAt, version } from "./_shared";
import { subjects } from "./academic";
import { absenceReason, attendanceStatus, auditAction } from "./enums";

export const attendanceLogs = app.table(
  "attendance_logs",
  {
    id: pk(),
    userId: ownerId(),
    subjectId: uuid().notNull(),
    /** Null = aula extra/reposição. FK (schedule_id, subject_id) criada na migration de segurança. */
    scheduleId: uuid(),
    classDate: date().notNull(),
    status: attendanceStatus().notNull(),
    unitsScheduled: smallint().notNull(),
    unitsMissed: smallint().notNull(),
    isExcused: boolean().notNull().default(false),
    reason: absenceReason(),
    note: text(),
    content: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "attendance_logs_subject_owner_fk",
      columns: [t.subjectId, t.userId],
      foreignColumns: [subjects.id, subjects.userId],
    }).onDelete("cascade"),
    unique("attendance_logs_one_per_occurrence")
      .on(t.subjectId, t.classDate, t.scheduleId)
      .nullsNotDistinct(),
    index("attendance_logs_subject_date_idx").on(t.subjectId, t.classDate.desc()),
    index("attendance_logs_user_date_idx").on(t.userId, t.classDate),
    check("attendance_logs_units_scheduled_chk", sql`${t.unitsScheduled} between 1 and 6`),
    check(
      "attendance_logs_status_units_chk",
      sql`(${t.status} = 'present' and ${t.unitsMissed} = 0)
       or (${t.status} = 'absent' and ${t.unitsMissed} = ${t.unitsScheduled})
       or (${t.status} = 'partial' and ${t.unitsMissed} between 1 and ${t.unitsScheduled} - 1)
       or (${t.status} = 'cancelled' and ${t.unitsMissed} = 0 and not ${t.isExcused})
       or (${t.status}::text = 'no_call' and ${t.unitsMissed} = 0 and not ${t.isExcused})`,
    ),
    check(
      "attendance_logs_excused_chk",
      sql`not ${t.isExcused} or ${t.status} in ('absent', 'partial')`,
    ),
    check("attendance_logs_note_chk", sql`char_length(${t.note}) <= 500`),
    check("attendance_logs_content_chk", sql`char_length(${t.content}) <= 2000`),
  ],
);

export const attendanceLogEvents = app.table(
  "attendance_log_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    logId: uuid().notNull(),
    userId: ownerId(),
    action: auditAction().notNull(),
    before: jsonb(),
    after: jsonb(),
    requestId: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendance_log_events_log_idx").on(t.logId, t.at),
    index("attendance_log_events_user_idx").on(t.userId, t.at),
  ],
);

export const subjectThresholdState = app.table(
  "subject_threshold_state",
  {
    subjectId: uuid().notNull(),
    thresholdPct: smallint().notNull(),
    userId: ownerId(),
    armed: boolean().notNull().default(true),
    cycle: integer().notNull().default(0),
    lastCrossedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "subject_threshold_state_pk", columns: [t.subjectId, t.thresholdPct] }),
    foreignKey({
      name: "subject_threshold_state_subject_owner_fk",
      columns: [t.subjectId, t.userId],
      foreignColumns: [subjects.id, subjects.userId],
    }).onDelete("cascade"),
    check("subject_threshold_state_pct_chk", sql`${t.thresholdPct} in (50, 75, 90, 100)`),
    check("subject_threshold_state_cycle_chk", sql`${t.cycle} >= 0`),
  ],
);
