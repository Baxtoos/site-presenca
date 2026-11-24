import { z } from "zod";
import { subjectColorSchema } from "./academic";

/** Tarefas e entregas: pendente até o aluno marcar se concluiu ou não. */
export const taskStatusSchema = z.enum(["pending", "completed", "not_completed"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** De onde veio a tarefa (as importadas chegam pelo conector do Moodle). */
export const taskSourceSchema = z.enum(["manual", "moodle_ics", "moodle_api"]);
export type TaskSource = z.infer<typeof taskSourceSchema>;
/** Quem definiu o status: o aluno sempre vence a sincronização. */
export const taskStatusSourceSchema = z.enum(["user", "sync"]);

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

/** Link para a atividade original: só https; vazio vira null. */
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
  /** null = sem aviso. */
  remindBeforeMinutes: taskRemindSchema.nullable().default(DEFAULT_TASK_REMIND),
  externalUrl: externalUrlSchema.optional(),
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
      /** Rótulo do semestre da matéria (ex.: "2026.2"). */
      semesterLabel: z.string(),
    })
    .nullable(),
  /** Instante do prazo (UTC). */
  dueAt: z.iso.datetime({ offset: true }),
  /** Prazo no fuso da conta, para mostrar e editar. */
  dueLocal: z.object({ date: z.iso.date(), time: z.string() }),
  remindBeforeMinutes: z.number().int().nullable(),
  status: taskStatusSchema,
  statusSource: taskStatusSourceSchema,
  source: taskSourceSchema,
  externalUrl: z.string().nullable(),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Pendente com o prazo já passado: pede para o aluno registrar se entregou. */
  overdue: z.boolean(),
  version: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;

/** Maior intervalo de datas aceito na listagem (o mesmo do calendário da matéria). */
export const TASK_RANGE_MAX_DAYS = 400;

export const taskListQuerySchema = z
  .object({
    status: taskStatusSchema.optional(),
    subjectId: z.uuid().optional(),
    /** Prazo a partir deste dia (inclusive), no fuso da conta. */
    from: z.iso.date({ error: "Use a data no formato AAAA-MM-DD." }).optional(),
    /** Prazo até este dia (inclusive), no fuso da conta. */
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

/** "24 h", "2 dias": a antecedência como o aluno lê. */
export function remindLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "24 h" : `${minutes / 1440} dias`;
  return `${minutes / 60} h`;
}
