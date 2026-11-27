import { z } from "zod";
import {
  calendarExceptionSchema,
  isoDateSchema,
  subjectColorSchema,
  subjectSummarySchema,
  timeSchema,
} from "./academic";

export const attendanceStatusSchema = z.enum([
  "present",
  "absent",
  "partial",
  "cancelled",
  "no_call",
]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const absenceReasonSchema = z.enum(["health", "work", "transport", "personal", "other"]);
export type AbsenceReason = z.infer<typeof absenceReasonSchema>;

export const noteSchema = z
  .string()
  .trim()
  .max(500, { error: "Use no máximo 500 caracteres." })
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const contentSchema = z
  .string()
  .trim()
  .max(2000, { error: "Use no máximo 2000 caracteres." })
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const unitsMissedSchema = z
  .number()
  .int()
  .min(1, { error: "Informe quantas aulas você perdeu." })
  .max(5, { error: "No máximo 5 aulas perdidas numa falta parcial." });

export function refineAttendance(
  body: { status?: AttendanceStatus; unitsMissed?: number; isExcused?: boolean },
  ctx: z.RefinementCtx,
) {
  if (body.status === "partial" && body.unitsMissed === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unitsMissed"],
      message: "Informe quantas aulas você perdeu.",
    });
  }
  if (body.status && body.status !== "partial" && body.unitsMissed !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unitsMissed"],
      message: "Aulas perdidas só se aplicam à falta parcial.",
    });
  }
  if (body.isExcused && body.status && body.status !== "absent" && body.status !== "partial") {
    ctx.addIssue({
      code: "custom",
      path: ["isExcused"],
      message: "Só falta (total ou parcial) pode ser abonada.",
    });
  }
}

export const createAttendanceBodySchema = z
  .object({
    subjectId: z.uuid({ error: "Matéria inválida." }),
    classDate: isoDateSchema,
    scheduleId: z.uuid().nullable().optional(),
    status: attendanceStatusSchema,
    unitsScheduled: z
      .number()
      .int()
      .min(1, { error: "De 1 a 6 aulas." })
      .max(6, { error: "De 1 a 6 aulas." })
      .optional(),
    unitsMissed: unitsMissedSchema.optional(),
    isExcused: z.boolean().default(false),
    reason: absenceReasonSchema.nullable().optional(),
    note: noteSchema.optional(),
    content: contentSchema.optional(),
  })
  .superRefine(refineAttendance);
export type CreateAttendanceBody = z.infer<typeof createAttendanceBodySchema>;

export const updateAttendanceBodySchema = z
  .object({
    status: attendanceStatusSchema,
    unitsMissed: unitsMissedSchema,
    isExcused: z.boolean(),
    reason: absenceReasonSchema.nullable(),
    note: noteSchema,
    content: contentSchema,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nada para atualizar." })
  .superRefine(refineAttendance);
export type UpdateAttendanceBody = z.infer<typeof updateAttendanceBodySchema>;

export const attendanceRecordSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  scheduleId: z.uuid().nullable(),
  classDate: isoDateSchema,
  status: attendanceStatusSchema,
  unitsScheduled: z.number().int(),
  unitsMissed: z.number().int(),
  isExcused: z.boolean(),
  reason: absenceReasonSchema.nullable(),
  note: z.string().nullable(),
  /** Conteúdo da aula. Default: tolera API antiga durante o deploy. */
  content: z.string().nullable().default(null),
  version: z.number().int(),
});
export type AttendanceRecord = z.output<typeof attendanceRecordSchema>;

export const attendanceResultSchema = z.object({
  record: attendanceRecordSchema,
  summary: subjectSummarySchema,
});
export type AttendanceResult = z.infer<typeof attendanceResultSchema>;

export const attendanceDeletedSchema = z.object({ summary: subjectSummarySchema });
export type AttendanceDeleted = z.infer<typeof attendanceDeletedSchema>;

export const attendanceParamsSchema = z.object({
  id: z.uuid({ error: "Identificador inválido." }),
});

export const attendanceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
  status: attendanceStatusSchema.optional(),
});
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;

export const attendanceListSchema = z.object({
  records: z.array(attendanceRecordSchema),
  nextCursor: z.string().nullable(),
});
export type AttendanceList = z.infer<typeof attendanceListSchema>;

export const todayQuerySchema = z.object({
  date: isoDateSchema.optional(),
});

export const todayClassSchema = z.object({
  subject: z.object({
    id: z.uuid(),
    name: z.string(),
    color: subjectColorSchema.nullable(),
    professor: z.string().nullable(),
    unitsPerClass: z.number().int(),
  }),
  scheduleId: z.uuid().nullable(),
  startsAt: timeSchema.nullable(),
  endsAt: timeSchema.nullable(),
  units: z.number().int(),
  room: z.string().nullable(),
  blocked: z.object({ kind: z.enum(["holiday", "no_classes"]), label: z.string() }).nullable(),
  record: attendanceRecordSchema.nullable(),
  summary: subjectSummarySchema,
});
export type TodayClass = z.infer<typeof todayClassSchema>;

export const todayResponseSchema = z.object({
  date: isoDateSchema,
  weekday: z.number().int().min(1).max(7),
  isToday: z.boolean(),
  classes: z.array(todayClassSchema),
  exceptions: z.array(calendarExceptionSchema.pick({ kind: true, label: true })),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Use o formato AAAA-MM." });

export const subjectCalendarQuerySchema = z.object({
  month: monthSchema.optional(),
});

export const calendarClassSchema = z.object({
  scheduleId: z.uuid().nullable(),
  startsAt: timeSchema.nullable(),
  endsAt: timeSchema.nullable(),
  units: z.number().int(),
  room: z.string().nullable(),
  blocked: todayClassSchema.shape.blocked,
  record: attendanceRecordSchema.nullable(),
});
export type CalendarClass = z.infer<typeof calendarClassSchema>;

export const subjectCalendarSchema = z.object({
  month: monthSchema,
  today: isoDateSchema,
  semester: z.object({ startsOn: isoDateSchema, endsOn: isoDateSchema }),
  prevMonth: monthSchema.nullable(),
  nextMonth: monthSchema.nullable(),
  days: z.array(z.object({ date: isoDateSchema, classes: z.array(calendarClassSchema) })),
  summary: subjectSummarySchema,
});
export type SubjectCalendar = z.infer<typeof subjectCalendarSchema>;

export const simulateResponseSchema = z.object({
  asOf: isoDateSchema,
  summary: subjectSummarySchema,
  nextClass: z
    .object({ date: isoDateSchema, units: z.number().int(), scheduleId: z.uuid().nullable() })
    .nullable(),
  ifSkipNext: z
    .object({
      absentUnits: z.number().int(),
      remainingUnits: z.number().int(),
      remainingClasses: z.number().int(),
      risk: subjectSummarySchema.shape.risk,
      projectedPresencePct: z.number().nullable(),
      allowed: z.boolean(),
    })
    .nullable(),
  plan: z.object({
    classes: z.number().int(),
    units: z.number().int(),
    untilDate: isoDateSchema.nullable(),
    firstUnsafe: z.object({ date: isoDateSchema, units: z.number().int() }).nullable(),
  }),
  upcomingClasses: z.number().int(),
});
export type SimulateResponse = z.infer<typeof simulateResponseSchema>;

export const AttendanceErrorCode = {
  conflict: "ATTENDANCE_CONFLICT",
  futureDate: "FUTURE_DATE",
  outOfSemester: "OUT_OF_SEMESTER",
  scheduleNotFound: "SCHEDULE_NOT_FOUND",
  idempotencyKeyRequired: "IDEMPOTENCY_KEY_REQUIRED",
  idempotencyKeyReused: "IDEMPOTENCY_KEY_REUSED",
} as const;

export const subjectEvolutionSchema = z.object({
  semester: z.object({ startsOn: isoDateSchema, endsOn: isoDateSchema }),
  today: isoDateSchema,
  absences: z.object({
    limit: z.number().int(),
    points: z.array(z.object({ date: isoDateSchema, total: z.number().int() })),
  }),
  grades: z
    .object({
      scale: z.number().int(),
      passing: z.number().int(),
      points: z.array(
        z.object({
          date: isoDateSchema,
          guaranteed: z.number().int(),
          partial: z.number().int().nullable(),
        }),
      ),
    })
    .nullable(),
});
export type SubjectEvolution = z.infer<typeof subjectEvolutionSchema>;
