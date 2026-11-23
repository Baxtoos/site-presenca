import { z } from "zod";

// ---------------------------------------------------------------- tipos básicos

/** Data local "AAAA-MM-DD" (sem hora nem fuso). */
export const isoDateSchema = z.iso.date({ error: "Use uma data válida (AAAA-MM-DD)." });

/** Horário "HH:MM" (24 h). */
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use o formato HH:MM (ex.: 19:00)." });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const SUBJECT_COLORS = [
  "blue",
  "violet",
  "amber",
  "teal",
  "rose",
  "green",
  "orange",
  "slate",
] as const;
export const subjectColorSchema = z.enum(SUBJECT_COLORS);

/** Presença mínima em centésimos de ponto percentual: 75% = 7500 (inteiro, sem arredondamento). */
export const minAttendanceBpSchema = z
  .number()
  .int()
  .min(0, { error: "A presença mínima vai de 0% a 100%." })
  .max(10_000, { error: "A presença mínima vai de 0% a 100%." });

export const idParamsSchema = z.object({ id: z.uuid({ error: "Identificador inválido." }) });
export const scheduleParamsSchema = idParamsSchema.extend({ scheduleId: z.uuid() });
export const exceptionParamsSchema = idParamsSchema.extend({ exceptionId: z.uuid() });

// ---------------------------------------------------------------- semestres

export const semesterStatusSchema = z.enum(["active", "archived"]);

export const createSemesterBodySchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, { error: "Dê um nome ao semestre (ex.: 2026.2)." })
      .max(20, { error: "Use no máximo 20 caracteres." }),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    isCurrent: z.boolean().default(false),
  })
  .refine((s) => s.endsOn > s.startsOn, {
    path: ["endsOn"],
    error: "O fim precisa ser depois do início.",
  });
export type CreateSemesterBody = z.infer<typeof createSemesterBodySchema>;

export const updateSemesterBodySchema = z
  .object({
    label: z.string().trim().min(1).max(20),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    isCurrent: z.boolean(),
    status: semesterStatusSchema,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nada para atualizar." })
  .refine((b) => !b.startsOn || !b.endsOn || b.endsOn > b.startsOn, {
    path: ["endsOn"],
    error: "O fim precisa ser depois do início.",
  });
export type UpdateSemesterBody = z.infer<typeof updateSemesterBodySchema>;

export const semesterSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  status: semesterStatusSchema,
  isCurrent: z.boolean(),
  subjectsCount: z.number().int(),
  version: z.number().int(),
});
export type Semester = z.infer<typeof semesterSchema>;
export const semestersResponseSchema = z.object({ semesters: z.array(semesterSchema) });
export type SemestersResponse = z.infer<typeof semestersResponseSchema>;

// ---------------------------------------------------------------- grade semanal

export const scheduleBodySchema = z
  .object({
    /** 1 = segunda … 7 = domingo. */
    weekday: z.number().int().min(1).max(7),
    startsAt: timeSchema,
    endsAt: timeSchema,
    /** Tempos de chamada deste encontro (aula geminada vale 2, 3…). */
    units: z
      .number()
      .int()
      .min(1, { error: "De 1 a 6 aulas." })
      .max(6, { error: "De 1 a 6 aulas." }),
    room: optionalText(40),
    building: optionalText(40),
    professor: optionalText(120),
    validFrom: isoDateSchema.nullable().optional(),
    validUntil: isoDateSchema.nullable().optional(),
  })
  .refine((s) => s.endsAt > s.startsAt, {
    path: ["endsAt"],
    error: "O fim precisa ser depois do início.",
  })
  .refine((s) => !s.validFrom || !s.validUntil || s.validUntil >= s.validFrom, {
    path: ["validUntil"],
    error: "A data final precisa ser igual ou depois da inicial.",
  });
export type ScheduleBody = z.infer<typeof scheduleBodySchema>;

export const scheduleSchema = z.object({
  id: z.uuid(),
  weekday: z.number().int(),
  startsAt: timeSchema,
  endsAt: timeSchema,
  units: z.number().int(),
  room: z.string().nullable(),
  building: z.string().nullable(),
  professor: z.string().nullable(),
  validFrom: isoDateSchema.nullable(),
  validUntil: isoDateSchema.nullable(),
  version: z.number().int(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

// ---------------------------------------------------------------- matérias

const subjectBase = {
  name: z.string().trim().min(1, { error: "Dê um nome à matéria." }).max(120),
  code: optionalText(20),
  professor: optionalText(120),
  color: subjectColorSchema.nullable().optional(),
  unitsPerClass: z
    .number()
    .int()
    .min(1, { error: "De 1 a 6 aulas." })
    .max(6, { error: "De 1 a 6 aulas." }),
  excusedPolicy: z.enum(["track_only", "deduct"]).default("track_only"),
};

const totalClassesSchema = z
  .number()
  .int()
  .min(1, { error: "Pelo menos 1 aula." })
  .max(1_000, { error: "No máximo 1000 aulas." });

/** As regras de contagem: cada modo exige campos diferentes. */
export const subjectRulesSchema = z.discriminatedUnion("countingMode", [
  z.object({
    countingMode: z.literal("class_count"),
    totalClasses: totalClassesSchema,
    minAttendanceBp: minAttendanceBpSchema,
  }),
  z.object({
    countingMode: z.literal("workload"),
    workloadHours: z
      .number()
      .positive({ error: "Informe a carga horária." })
      .max(1_000, { error: "No máximo 1000 horas." })
      .refine((h) => Math.abs(h * 100 - Math.round(h * 100)) < 1e-6, {
        error: "Use no máximo 2 casas decimais.",
      }),
    workloadHourMinutes: z.union([z.literal(45), z.literal(50), z.literal(60)], {
      error: "Escolha hora-relógio (60) ou hora-aula de 50 ou 45 minutos.",
    }),
    unitMinutes: z
      .number()
      .int()
      .min(10, { error: "De 10 a 240 minutos." })
      .max(240, { error: "De 10 a 240 minutos." }),
    minAttendanceBp: minAttendanceBpSchema,
  }),
  z.object({
    countingMode: z.literal("manual"),
    manualMaxUnits: z.number().int().min(0).max(1_000),
    totalClasses: totalClassesSchema.nullable().optional(),
  }),
]);
export type SubjectRulesBody = z.infer<typeof subjectRulesSchema>;

/** Dados + regras da matéria (sem a grade). Usado para criar e para substituir (PUT). */
export const subjectBodySchema = z.intersection(z.object(subjectBase), subjectRulesSchema);
export type SubjectBody = z.infer<typeof subjectBodySchema>;

/** Criação: dados, regras e (opcionalmente) a grade, gravados numa transação só. */
export const createSubjectBodySchema = z.intersection(
  subjectBodySchema,
  z.object({
    schedules: z.array(scheduleBodySchema).max(14, { error: "No máximo 14 horários." }).default([]),
  }),
);
export type CreateSubjectBody = z.infer<typeof createSubjectBodySchema>;

export const riskSchema = z.enum(["safe", "warning", "critical", "limit", "failed"]);

/** Números calculados pelo motor (packages/engine) a partir das regras e dos registros. */
export const subjectSummarySchema = z.object({
  totalUnits: z.number().int().nullable(),
  maxAbsenceUnits: z.number().int(),
  absentUnits: z.number().int(),
  excusedUnits: z.number().int(),
  heldUnits: z.number().int(),
  remainingUnits: z.number().int(),
  remainingClasses: z.number().int(),
  exceededBy: z.number().int(),
  consumptionPct: z.number().int(),
  risk: riskSchema,
  projectedPresencePct: z.number().nullable(),
  presenceSoFarPct: z.number().nullable(),
});
export type SubjectSummaryDto = z.infer<typeof subjectSummarySchema>;

export const subjectSchema = z.object({
  id: z.uuid(),
  semesterId: z.uuid(),
  name: z.string(),
  code: z.string().nullable(),
  professor: z.string().nullable(),
  color: subjectColorSchema.nullable(),
  countingMode: z.enum(["class_count", "workload", "manual"]),
  totalClasses: z.number().int().nullable(),
  unitsPerClass: z.number().int(),
  workloadHours: z.number().nullable(),
  workloadHourMinutes: z.number().int().nullable(),
  unitMinutes: z.number().int().nullable(),
  minAttendanceBp: z.number().int(),
  manualMaxUnits: z.number().int().nullable(),
  excusedPolicy: z.enum(["track_only", "deduct"]),
  version: z.number().int(),
  schedules: z.array(scheduleSchema),
  summary: subjectSummarySchema,
});
export type Subject = z.infer<typeof subjectSchema>;
export const subjectsResponseSchema = z.object({ subjects: z.array(subjectSchema) });
export type SubjectsResponse = z.infer<typeof subjectsResponseSchema>;

// ---------------------------------------------------------------- feriados e exceções

export const exceptionKindSchema = z.enum(["holiday", "no_classes", "exam_week"]);

export const exceptionBodySchema = z
  .object({
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    kind: exceptionKindSchema,
    label: z.string().trim().min(1, { error: "Dê um nome (ex.: Carnaval)." }).max(120),
    /** Null/ausente: vale para todas as matérias do semestre. */
    subjectId: z.uuid().nullable().optional(),
  })
  .refine((e) => e.endsOn >= e.startsOn, {
    path: ["endsOn"],
    error: "O fim precisa ser igual ou depois do início.",
  });
export type ExceptionBody = z.infer<typeof exceptionBodySchema>;

export const calendarExceptionSchema = z.object({
  id: z.uuid(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  kind: exceptionKindSchema,
  label: z.string(),
  subjectId: z.uuid().nullable(),
});
export type CalendarExceptionDto = z.infer<typeof calendarExceptionSchema>;
export const exceptionsResponseSchema = z.object({ exceptions: z.array(calendarExceptionSchema) });
export type ExceptionsResponse = z.infer<typeof exceptionsResponseSchema>;

/** Códigos de erro das rotas acadêmicas. */
export const AcademicErrorCode = {
  semesterLabelTaken: "SEMESTER_LABEL_TAKEN",
  outOfSemester: "OUT_OF_SEMESTER",
  subjectNotInSemester: "SUBJECT_NOT_IN_SEMESTER",
  versionMismatch: "VERSION_MISMATCH",
  versionRequired: "VERSION_REQUIRED",
} as const;
