import { z } from "zod";
import {
  createSubjectBodySchema,
  exceptionKindSchema,
  isoDateSchema,
  subjectColorSchema,
  timeSchema,
} from "./academic";

// ---------------------------------------------------------------- código

/** Alfabeto Crockford base32: sem I, L, O e U (não se confundem com 1, 0 e V ao ditar). */
export const SHARE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Lê um código como a pessoa digitou: ignora espaços e hífens, aceita minúsculas e corrige as
 * trocas comuns (I/L → 1, O → 0). Devolve os 8 caracteres canônicos, ou null se não for um código.
 */
export function normalizeShareCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(cleaned) ? cleaned : null;
}

/** "ABCD2345" → "ABCD-2345" (mais fácil de ditar e de ler). */
export const formatShareCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const shareCodeParamsSchema = z.object({
  code: z.string().transform((value, ctx) => {
    const code = normalizeShareCode(value);
    if (!code) {
      ctx.addIssue({ code: "custom", message: "Código inválido. Ele tem 8 letras e números." });
      return z.NEVER;
    }
    return code;
  }),
});

// ---------------------------------------------------------------- modelo (payload)

/** Uma matéria do modelo: dados, regras e grade. Nunca contém faltas nem registros. */
export const templateSubjectSchema = createSubjectBodySchema;
export type TemplateSubject = z.infer<typeof templateSubjectSchema>;

export const templateExceptionSchema = z.object({
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  kind: exceptionKindSchema,
  label: z.string().min(1).max(120),
  /** Índice da matéria em `subjects` (exceção só dela), ou null (vale para o semestre todo). */
  subjectIndex: z.number().int().min(0).nullable(),
});

export const semesterTemplatePayloadSchema = z.object({
  semester: z.object({
    label: z.string().min(1).max(60),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  }),
  subjects: z.array(templateSubjectSchema).max(30),
  exceptions: z.array(templateExceptionSchema).max(100),
});
export type SemesterTemplatePayload = z.infer<typeof semesterTemplatePayloadSchema>;

export const subjectTemplatePayloadSchema = z.object({ subject: templateSubjectSchema });
export type SubjectTemplatePayload = z.infer<typeof subjectTemplatePayloadSchema>;

export const templateKindSchema = z.enum(["semester", "subject"]);
export type TemplateKind = z.infer<typeof templateKindSchema>;

// ---------------------------------------------------------------- criar e listar

const optionalLabel = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const createTemplateBodySchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("semester"), semesterId: z.uuid() }),
    z.object({ kind: z.literal("subject"), subjectId: z.uuid() }),
  ]),
  /** Nome que os colegas veem. Padrão: o nome do semestre ou da matéria. */
  title: optionalLabel(120),
  institution: optionalLabel(120),
  course: optionalLabel(120),
  expiresInDays: z
    .number()
    .int()
    .min(1, { error: "De 1 a 90 dias." })
    .max(90, { error: "De 1 a 90 dias." })
    .default(30),
  /** Null: sem limite de importações. */
  maxUses: z
    .number()
    .int()
    .min(1, { error: "De 1 a 500 usos." })
    .max(500, { error: "De 1 a 500 usos." })
    .nullable()
    .default(null),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

export const templateStatusSchema = z.enum(["active", "expired", "revoked", "exhausted"]);

export const sharedTemplateSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  kind: templateKindSchema,
  title: z.string(),
  institution: z.string().nullable(),
  course: z.string().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  maxUses: z.number().int().nullable(),
  usesCount: z.number().int(),
  status: templateStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type SharedTemplate = z.infer<typeof sharedTemplateSchema>;

export const sharedTemplatesResponseSchema = z.object({ templates: z.array(sharedTemplateSchema) });

export const templateIdParamsSchema = z.object({
  id: z.uuid({ error: "Identificador inválido." }),
});

// ---------------------------------------------------------------- prévia (pública)

export const templatePreviewSchema = z.object({
  code: z.string(),
  kind: templateKindSchema,
  title: z.string(),
  institution: z.string().nullable(),
  course: z.string().nullable(),
  usesCount: z.number().int(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  semester: z
    .object({ label: z.string(), startsOn: isoDateSchema, endsOn: isoDateSchema })
    .nullable(),
  subjects: z.array(
    z.object({
      name: z.string(),
      professor: z.string().nullable(),
      color: subjectColorSchema.nullable(),
      unitsPerClass: z.number().int(),
      /** Limite de faltas calculado pelo motor com as regras do modelo. */
      maxAbsenceUnits: z.number().int(),
      schedules: z.array(
        z.object({
          weekday: z.number().int(),
          startsAt: timeSchema,
          endsAt: timeSchema,
          room: z.string().nullable(),
        }),
      ),
    }),
  ),
  exceptions: z.array(
    z.object({ startsOn: isoDateSchema, endsOn: isoDateSchema, label: z.string() }),
  ),
});
export type TemplatePreview = z.infer<typeof templatePreviewSchema>;

// ---------------------------------------------------------------- importar

export const importTemplateBodySchema = z.object({
  /** Obrigatório para modelo de matéria: em qual semestre seu ela entra. */
  semesterId: z.uuid().optional(),
  /** Modelo de semestre: nome do semestre criado (padrão: o do modelo). */
  label: z.string().trim().min(1).max(60).optional(),
});
export type ImportTemplateBody = z.infer<typeof importTemplateBodySchema>;

export const importTemplateResultSchema = z.object({
  semesterId: z.uuid(),
  subjectIds: z.array(z.uuid()),
  /** O semestre foi criado agora (modelo de semestre) ou já existia (modelo de matéria). */
  createdSemester: z.boolean(),
});
export type ImportTemplateResult = z.infer<typeof importTemplateResultSchema>;

export const SharingErrorCode = {
  notFound: "TEMPLATE_NOT_FOUND",
  limit: "TEMPLATE_LIMIT",
  empty: "TEMPLATE_EMPTY",
  semesterRequired: "TEMPLATE_SEMESTER_REQUIRED",
  invalidPayload: "TEMPLATE_INVALID",
} as const;
