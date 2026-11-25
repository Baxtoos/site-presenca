import { z } from "zod";
import {
  calendarExceptionSchema,
  isoDateSchema,
  subjectColorSchema,
  subjectSummarySchema,
  timeSchema,
} from "./academic";

/** no_call: a aula aconteceu sem chamada (conta como dada, sem falta). */
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

/** O que foi passado na aula (opcional). Vazio vira null. */
export const contentSchema = z
  .string()
  .trim()
  .max(2000, { error: "Use no máximo 2000 caracteres." })
  .transform((v) => (v === "" ? null : v))
  .nullable();

// ---------------------------------------------------------------- registro

export const unitsMissedSchema = z
  .number()
  .int()
  .min(1, { error: "Informe quantas aulas você perdeu." })
  .max(5, { error: "No máximo 5 aulas perdidas numa falta parcial." });

/** Regras que dependem só do corpo; as que dependem do banco (tempos da aula) ficam na API. */
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
    /** Horário da grade a que o registro se refere. Ausente = aula extra ou reposição. */
    scheduleId: z.uuid().nullable().optional(),
    status: attendanceStatusSchema,
    /** Só para aula extra (sem scheduleId): quantos tempos de chamada ela vale. Padrão: o da matéria. */
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

/** Resposta de criar/editar: o registro e o resumo da matéria já recalculado pelo motor. */
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

// ---------------------------------------------------------------- histórico

export const attendanceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Cursor opaco devolvido em `nextCursor`. */
  cursor: z.string().max(200).optional(),
  status: attendanceStatusSchema.optional(),
});
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;

export const attendanceListSchema = z.object({
  records: z.array(attendanceRecordSchema),
  nextCursor: z.string().nullable(),
});
export type AttendanceList = z.infer<typeof attendanceListSchema>;

// ---------------------------------------------------------------- aulas de hoje

export const todayQuerySchema = z.object({
  /** Dia a consultar (no máximo hoje). Padrão: hoje no fuso do aluno. */
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
  /** Null = aula extra registrada fora da grade. */
  scheduleId: z.uuid().nullable(),
  startsAt: timeSchema.nullable(),
  endsAt: timeSchema.nullable(),
  units: z.number().int(),
  room: z.string().nullable(),
  /** Preenchido quando um feriado ou dia sem aula cancela esta aula. */
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

// ---------------------------------------------------------------- calendário da matéria

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Use o formato AAAA-MM." });

export const subjectCalendarQuerySchema = z.object({
  /** Mês a mostrar (AAAA-MM). Padrão: o mês de hoje, ou o mais próximo dentro do semestre. */
  month: monthSchema.optional(),
});

/** Uma aula num dia do calendário: da grade (scheduleId) ou extra, registrada fora dela. */
export const calendarClassSchema = z.object({
  /** Null = aula extra registrada fora da grade. */
  scheduleId: z.uuid().nullable(),
  startsAt: timeSchema.nullable(),
  endsAt: timeSchema.nullable(),
  units: z.number().int(),
  room: z.string().nullable(),
  /** Feriado ou dia sem aula que cancela esta aula. */
  blocked: todayClassSchema.shape.blocked,
  record: attendanceRecordSchema.nullable(),
});
export type CalendarClass = z.infer<typeof calendarClassSchema>;

export const subjectCalendarSchema = z.object({
  month: monthSchema,
  /** Hoje, no fuso do aluno: dias depois de hoje não podem ser marcados. */
  today: isoDateSchema,
  semester: z.object({ startsOn: isoDateSchema, endsOn: isoDateSchema }),
  /** Mês anterior e seguinte que ainda têm dias do semestre (null = fora do semestre). */
  prevMonth: monthSchema.nullable(),
  nextMonth: monthSchema.nullable(),
  /** Só os dias com aula (ou com registro) dentro do semestre, em ordem. */
  days: z.array(z.object({ date: isoDateSchema, classes: z.array(calendarClassSchema) })),
  summary: subjectSummarySchema,
});
export type SubjectCalendar = z.infer<typeof subjectCalendarSchema>;

// ---------------------------------------------------------------- "Posso faltar?"

export const simulateResponseSchema = z.object({
  /** Hoje, no fuso do aluno. */
  asOf: isoDateSchema,
  summary: subjectSummarySchema,
  nextClass: z
    .object({ date: isoDateSchema, units: z.number().int(), scheduleId: z.uuid().nullable() })
    .nullable(),
  /** O que acontece se faltar à próxima aula. Null se não há aula futura. */
  ifSkipNext: z
    .object({
      absentUnits: z.number().int(),
      remainingUnits: z.number().int(),
      remainingClasses: z.number().int(),
      risk: subjectSummarySchema.shape.risk,
      projectedPresencePct: z.number().nullable(),
      /** true = ainda dentro do limite depois dessa falta. */
      allowed: z.boolean(),
    })
    .nullable(),
  /** Quantas aulas seguidas dá para faltar sem passar do limite, no calendário real. */
  plan: z.object({
    classes: z.number().int(),
    units: z.number().int(),
    untilDate: isoDateSchema.nullable(),
    firstUnsafe: z.object({ date: isoDateSchema, units: z.number().int() }).nullable(),
  }),
  upcomingClasses: z.number().int(),
});
export type SimulateResponse = z.infer<typeof simulateResponseSchema>;

/** Códigos de erro das rotas de presença. */
export const AttendanceErrorCode = {
  conflict: "ATTENDANCE_CONFLICT",
  futureDate: "FUTURE_DATE",
  outOfSemester: "OUT_OF_SEMESTER",
  scheduleNotFound: "SCHEDULE_NOT_FOUND",
  idempotencyKeyRequired: "IDEMPOTENCY_KEY_REQUIRED",
  idempotencyKeyReused: "IDEMPOTENCY_KEY_REUSED",
} as const;
