import { z } from "zod";
import { subjectColorSchema } from "./academic";

export const taskStatusSchema = z.enum(["pending", "completed", "not_completed"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskSourceSchema = z.enum(["manual", "moodle_ics", "moodle_api"]);
export type TaskSource = z.infer<typeof taskSourceSchema>;
export const taskStatusSourceSchema = z.enum(["user", "sync"]);

export const TASK_REMIND_OPTIONS = [60, 180, 720, 1440, 2880] as const;
export const DEFAULT_TASK_REMIND = 1440;

export const taskRemindSchema = z.union(
  TASK_REMIND_OPTIONS.map((m) => z.literal(m)),
  {
    error: "Escolha 1 h, 3 h, 12 h, 24 h ou 2 dias.",
  },
);

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

const externalUrlSchema = z
  .string()
  .trim()
  .max(2000, { error: "Use um link com até 2000 caracteres." })
  .transform((v) => (v === "" ? null : v))
  .pipe(
    z
      .url({
        protocol: /^https$/,
        hostname: z.regexes.domain,
        error: "Informe o link completo da atividade, começando com https://.",
      })
      .nullable(),
  )
  .nullable();

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
  remindBeforeMinutes: taskRemindSchema.nullable().default(DEFAULT_TASK_REMIND),
  externalUrl: externalUrlSchema.optional(),
  evaluationItemId: z.uuid().nullable().optional(),
});
export type CreateTaskBody = z.input<typeof createTaskBodySchema>;

export const updateTaskBodySchema = z
  .object({
    title: titleSchema,
    notes: notesSchema,
    subjectId: z.uuid({ error: "Matéria inválida." }).nullable(),
    dueAt: localDateTimeSchema,
    remindBeforeMinutes: taskRemindSchema.nullable(),
    status: taskStatusSchema,
    externalUrl: externalUrlSchema,
    evaluationItemId: z.uuid().nullable(),
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
    .object({
      id: z.uuid(),
      name: z.string(),
      code: z.string().nullable(),
      color: subjectColorSchema.nullable(),
      semesterLabel: z.string(),
    })
    .nullable(),
  dueAt: z.iso.datetime({ offset: true }),
  dueLocal: z.object({ date: z.iso.date(), time: z.string() }),
  remindBeforeMinutes: z.number().int().nullable(),
  status: taskStatusSchema,
  statusSource: taskStatusSourceSchema,
  source: taskSourceSchema,
  externalUrl: z.string().nullable(),
  evaluation: z
    .object({
      id: z.uuid(),
      name: z.string(),
      score: z.number().int().nullable(),
      maxScore: z.number().int(),
    })
    .nullable(),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  overdue: z.boolean(),
  version: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;

export const TASK_RANGE_MAX_DAYS = 400;

export const taskListQuerySchema = z
  .object({
    status: taskStatusSchema.optional(),
    subjectId: z.uuid().optional(),
    from: z.iso.date({ error: "Use a data no formato AAAA-MM-DD." }).optional(),
    to: z.iso.date({ error: "Use a data no formato AAAA-MM-DD." }).optional(),
    order: z.enum(["due_asc", "due_desc"]).default("due_asc"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .superRefine((q, ctx) => {
    if (!q.from || !q.to) return;
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (days < 0) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "A data final vem antes da inicial." });
    } else if (days >= TASK_RANGE_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Use um intervalo de até ${TASK_RANGE_MAX_DAYS} dias.`,
      });
    }
  });
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  nextCursor: z.string().nullable(),
});
export type TaskList = z.infer<typeof taskListSchema>;

export const taskParamsSchema = z.object({ id: z.uuid({ error: "Tarefa inválida." }) });

export function remindLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "24 h" : `${minutes / 1440} dias`;
  return `${minutes / 60} h`;
}
