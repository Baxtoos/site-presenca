import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, ownerId, pk, updatedAt, version } from "./_shared";
import { countingMode, exceptionKind, excusedPolicy, semesterStatus } from "./enums";
import { users } from "./identity";

export const semesters = app.table(
  "semesters",
  {
    id: pk(),
    userId: ownerId().references(() => users.id, { onDelete: "cascade" }),
    label: text().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    status: semesterStatus().notNull().default("active"),
    isCurrent: boolean().notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Alvo das FKs compostas: garante que filhos pertencem ao mesmo dono.
    unique("semesters_id_user_key").on(t.id, t.userId),
    unique("semesters_user_label_key").on(t.userId, t.label),
    uniqueIndex("semesters_one_current_idx")
      .on(t.userId)
      .where(sql`${t.isCurrent}`),
    check("semesters_dates_chk", sql`${t.endsOn} > ${t.startsOn}`),
    check("semesters_label_chk", sql`char_length(${t.label}) between 1 and 20`),
  ],
);

export const subjects = app.table(
  "subjects",
  {
    id: pk(),
    userId: ownerId().references(() => users.id, { onDelete: "cascade" }),
    semesterId: uuid().notNull(),
    name: text().notNull(),
    code: text(),
    professor: text(),
    color: text(),
    countingMode: countingMode().notNull(),
    totalClasses: smallint(),
    unitsPerClass: smallint().notNull().default(1),
    workloadHours: numeric({ precision: 6, scale: 2 }),
    workloadHourMinutes: smallint(),
    unitMinutes: smallint(),
    /** Presença mínima em centésimos de ponto percentual (7500 = 75%). */
    minAttendanceBp: smallint().notNull().default(7500),
    manualMaxUnits: smallint(),
    excusedPolicy: excusedPolicy().notNull().default("track_only"),
    /** Referência informativa ao modelo importado (FK criada na migration de segurança). */
    sourceTemplateId: uuid(),
    archivedAt: timestamp({ withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("subjects_id_user_key").on(t.id, t.userId),
    foreignKey({
      name: "subjects_semester_owner_fk",
      columns: [t.semesterId, t.userId],
      foreignColumns: [semesters.id, semesters.userId],
    }).onDelete("cascade"),
    index("subjects_user_semester_idx").on(t.userId, t.semesterId),
    check("subjects_name_chk", sql`char_length(${t.name}) between 1 and 120`),
    check("subjects_units_per_class_chk", sql`${t.unitsPerClass} between 1 and 6`),
    check("subjects_min_attendance_chk", sql`${t.minAttendanceBp} between 0 and 10000`),
    // coalesce(…, false): com campo NULL a expressão daria NULL, e CHECK aceita NULL.
    check(
      "subjects_mode_fields_chk",
      sql`coalesce(case ${t.countingMode}
        when 'class_count' then ${t.totalClasses} > 0
        when 'workload' then ${t.workloadHours} > 0 and ${t.workloadHourMinutes} in (45, 50, 60)
                             and ${t.unitMinutes} between 10 and 240
        when 'manual' then ${t.manualMaxUnits} >= 0
      end, false)`,
    ),
    check("subjects_total_classes_chk", sql`${t.totalClasses} is null or ${t.totalClasses} > 0`),
  ],
);

export const subjectSchedules = app.table(
  "subject_schedules",
  {
    id: pk(),
    userId: ownerId(),
    subjectId: uuid().notNull(),
    /** 1 = segunda … 7 = domingo (ISO 8601). */
    weekday: smallint().notNull(),
    startsAt: time().notNull(),
    endsAt: time().notNull(),
    /** Tempos de chamada deste encontro (aulas geminadas). */
    units: smallint().notNull().default(1),
    room: text(),
    building: text(),
    professor: text(),
    validFrom: date(),
    validUntil: date(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("subject_schedules_id_subject_key").on(t.id, t.subjectId),
    foreignKey({
      name: "subject_schedules_subject_owner_fk",
      columns: [t.subjectId, t.userId],
      foreignColumns: [subjects.id, subjects.userId],
    }).onDelete("cascade"),
    index("subject_schedules_user_weekday_idx").on(t.userId, t.weekday),
    index("subject_schedules_subject_idx").on(t.subjectId),
    check("subject_schedules_weekday_chk", sql`${t.weekday} between 1 and 7`),
    check("subject_schedules_time_chk", sql`${t.endsAt} > ${t.startsAt}`),
    check("subject_schedules_units_chk", sql`${t.units} between 1 and 6`),
    check(
      "subject_schedules_validity_chk",
      sql`${t.validFrom} is null or ${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom}`,
    ),
  ],
);

export const calendarExceptions = app.table(
  "calendar_exceptions",
  {
    id: pk(),
    userId: ownerId(),
    semesterId: uuid().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    kind: exceptionKind().notNull(),
    /** Null = vale para todas as matérias. FK composta criada na migration de segurança. */
    subjectId: uuid(),
    label: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "calendar_exceptions_semester_owner_fk",
      columns: [t.semesterId, t.userId],
      foreignColumns: [semesters.id, semesters.userId],
    }).onDelete("cascade"),
    index("calendar_exceptions_semester_idx").on(t.semesterId, t.startsOn),
    check("calendar_exceptions_dates_chk", sql`${t.endsOn} >= ${t.startsOn}`),
    check("calendar_exceptions_label_chk", sql`char_length(${t.label}) between 1 and 120`),
  ],
);
