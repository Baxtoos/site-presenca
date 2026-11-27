import { z } from "zod";
import { isoDateSchema, timeSchema } from "./academic";
import { suapGradesSchema } from "./grades";

export const suapLessonSchema = z.object({
  date: isoDateSchema,
  units: z.number().int().min(1).max(12),
  absences: z.number().int().min(0).max(12),
  excused: z.boolean(),
  content: z.string().max(300).default(""),
});
export type SuapLesson = z.infer<typeof suapLessonSchema>;

export const suapSlotSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startsAt: timeSchema,
  endsAt: timeSchema,
});
export type SuapSlot = z.infer<typeof suapSlotSchema>;

export const suapSubjectSchema = z.object({
  diario: z.string().regex(/^\d{1,12}$/),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  plannedUnits: z.number().int().min(0).max(2000).nullable(),
  deliveredUnits: z.number().int().min(0).max(2000).nullable(),
  absences: z.number().int().min(0).max(2000).nullable(),
  frequencyPct: z.number().min(0).max(100).nullable(),
  professor: z.string().trim().max(120).nullable(),
  location: z.string().trim().max(300).nullable(),
  slots: z.array(suapSlotSchema).max(60),
  lessons: z.array(suapLessonSchema).max(400),
  grades: suapGradesSchema.nullable().default(null),
});
export type SuapSubject = z.infer<typeof suapSubjectSchema>;

export const SUAP_FORMAT = "suap";

export const suapSnapshotSchema = z.object({
  format: z.literal(SUAP_FORMAT),
  version: z.literal(1),
  host: z.string().max(100),
  period: z.string().regex(/^\d{4}_[12]$/),
  subjects: z.array(suapSubjectSchema).min(1).max(30),
});
export type SuapSnapshot = z.infer<typeof suapSnapshotSchema>;

export const suapSyncBodySchema = z.object({
  semesterId: z.uuid().nullable(),
  label: z.string().trim().min(1).max(60).optional(),
  snapshot: suapSnapshotSchema,
});
export type SuapSyncBody = z.infer<typeof suapSyncBodySchema>;

export const suapSyncResultSchema = z.object({
  semesterId: z.uuid(),
  label: z.string(),
  createdSemester: z.boolean(),
  subjectsCreated: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  future: z.number().int(),
});
export type SuapSyncResult = z.infer<typeof suapSyncResultSchema>;
