import { z } from "zod";
import { isoDateSchema } from "./academic";
import {
  absenceReasonSchema,
  attendanceStatusSchema,
  noteSchema,
  refineAttendance,
  unitsMissedSchema,
} from "./attendance";
import { semesterTemplatePayloadSchema } from "./sharing";

/**
 * Importar um semestre a partir da planilha que o próprio app exporta: estrutura (o mesmo
 * formato do compartilhamento de grade) + os registros de presença.
 */
export const importAttendanceSchema = z
  .object({
    /** Índice da matéria em `subjects`. */
    subjectIndex: z.number().int().min(0),
    /** Índice do horário em `subjects[i].schedules`, ou null para aula extra (fora da grade). */
    scheduleIndex: z.number().int().min(0).nullable(),
    classDate: isoDateSchema,
    status: attendanceStatusSchema,
    /** Só aula extra: quantos tempos ela vale. Padrão: o da matéria. */
    unitsScheduled: z.number().int().min(1).max(6).optional(),
    unitsMissed: unitsMissedSchema.optional(),
    isExcused: z.boolean().default(false),
    reason: absenceReasonSchema.nullable().optional(),
    note: noteSchema.optional(),
  })
  .superRefine(refineAttendance);
export type ImportAttendance = z.infer<typeof importAttendanceSchema>;

export const MAX_IMPORT_ATTENDANCE = 3000;

export const semesterImportBodySchema = semesterTemplatePayloadSchema.extend({
  attendance: z
    .array(importAttendanceSchema)
    .max(MAX_IMPORT_ATTENDANCE, { error: `No máximo ${MAX_IMPORT_ATTENDANCE} registros.` }),
});
export type SemesterImportBody = z.infer<typeof semesterImportBodySchema>;

export const semesterImportResultSchema = z.object({
  semesterId: z.uuid(),
  label: z.string(),
  subjects: z.number().int(),
  attendance: z.number().int(),
});
export type SemesterImportResult = z.infer<typeof semesterImportResultSchema>;

// ---------------------------------------------------------------- aba oculta da planilha

/** Nome da aba oculta ("muito oculta") com os dados completos, na planilha exportada. */
export const SPREADSHEET_DATA_SHEET = "Dados";
export const SPREADSHEET_FORMAT = "presenca-semestre";
/** Tamanho de cada pedaço do JSON por célula (o Excel aceita até 32.767 caracteres). */
export const SPREADSHEET_CHUNK = 30_000;

export const spreadsheetDataSchema = z.object({
  format: z.literal(SPREADSHEET_FORMAT),
  version: z.literal(1),
  data: semesterImportBodySchema,
});
export type SpreadsheetData = z.infer<typeof spreadsheetDataSchema>;
