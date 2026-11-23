import { z } from "zod";
import { subjectColorSchema } from "./academic";

/** Tarefas e entregas: pendente até o aluno marcar se concluiu ou não. */
export const taskStatusSchema = z.enum(["pending", "completed", "not_completed"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Antecedências do aviso, em minutos antes do prazo (o banco confere a mesma lista). */
export const TASK_REMIND_OPTIONS = [60, 180, 720, 1440, 2880] as const;
export const DEFAULT_TASK_REMIND = 1440;

export const taskRemindSchema = z.union(
  TASK_REMIND_OPTIONS.map((m) => z.literal(m)),
  {
    error: "Escolha 1 h, 3 h, 12 h, 24 h ou 2 dias.",
  },
);

/**
 * Prazo como o aluno digita, sem fuso: "2026-11-30T23:59". A API interpreta no fuso da conta
 * (users.timezone).
 */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/, {
    error: "Informe data e hora do prazo (ex.: 2026-11-30T23:59).",
  });

const titleSchema = z
  .string()
  .trim()
  .min(1, { error: "Dê um título para a tarefa." })
  .max(200, { error: "Use no máximo 200 caracteres." });

const notesSchema = z
  .string()
  .trim()
  .max(2000, { error: "Use no máximo 2000 caracteres." })
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const createTaskBodySchema = z.object({
  title: titleSchema,
  notes: notesSchema.optional(),
  subjectId: z.uuid({ error: "Matéria inválida." }).nullable().optional(),
  dueAt: localDateTimeSchema,
  remindBeforeMinutes: taskRemindSchema.default(DEFAULT_TASK_REMIND),
});
export type CreateTaskBody = z.input<typeof createTaskBodySchema>;

export const updateTaskBodySchema = z
  .object({
    title: titleSchema,
    notes: notesSchema,
    subjectId: z.uuid({ error: "Matéria inválida." }).nullable(),
    dueAt: localDateTimeSchema,
    remindBeforeMinutes: taskRemindSchema,
    status: taskStatusSchema,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nada para alterar." });
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  subjectId: z.uuid().nullable(),
  subject: z
    .object({ id: z.uuid(), name: z.string(), color: subjectColorSchema.nullable() })
    .nullable(),
  /** Instante do prazo (UTC). */
  dueAt: z.iso.datetime({ offset: true }),
  /** Prazo no fuso da conta, para mostrar e editar. */
  dueLocal: z.object({ date: z.iso.date(), time: z.string() }),
  remindBeforeMinutes: z.number().int(),
  status: taskStatusSchema,
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Pendente com o prazo já passado: pede para o aluno registrar se entregou. */
  overdue: z.boolean(),
  version: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  subjectId: z.uuid().optional(),
  order: z.enum(["due_asc", "due_desc"]).default("due_asc"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  nextCursor: z.string().nullable(),
});
export type TaskList = z.infer<typeof taskListSchema>;

export const taskParamsSchema = z.object({ id: z.uuid({ error: "Tarefa inválida." }) });

/** "24 h antes", "2 dias antes": a antecedência como o aluno lê. */
export function remindLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "24 h" : `${minutes / 1440} dias`;
  return `${minutes / 60} h`;
}
