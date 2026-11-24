import { z } from "zod";

/**
 * Notas: cada matéria tem a sua regra de cálculo (o professor calcula como quiser) e as avaliações
 * com as notas lançadas. Notas em centésimos de ponto (7,5 → 750). A conta é feita pelo motor
 * (packages/engine/src/grades), nunca guardada.
 */

const keySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]{0,29}$/, {
    error: "Use um nome curto, sem espaços (ex.: P1, Lista2, Trabalho).",
  });
const centi = z.number().int().min(0).max(10_000);

export const gradeGroupSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(60),
  aggregate: z.enum(["mean", "sum"]),
  dropLowest: z.number().int().min(0).max(20),
});

export const gradingRulesSchema = z.object({
  scale: z.union([z.literal(10), z.literal(100)]),
  passing: centi.min(1, { error: "Informe a nota mínima para passar." }),
  formula: z.string().trim().min(1, { error: "Informe a fórmula." }).max(500),
  groups: z.array(gradeGroupSchema).max(10).default([]),
  exam: z
    .object({
      minToTake: centi,
      formula: z.string().trim().min(1).max(200),
      passing: centi.min(1),
    })
    .nullable()
    .default(null),
  substitute: z
    .object({ replaces: z.array(keySchema).min(1).max(20) })
    .nullable()
    .default(null),
  roundingStep: z.union([1, 5, 10, 25, 50, 100].map((n) => z.literal(n))).default(1),
});
export type GradingRulesDto = z.infer<typeof gradingRulesSchema>;

export const evaluationRoleSchema = z.enum(["regular", "substitute", "exam"]);

export const evaluationItemInputSchema = z.object({
  /** Avaliação já existente (mantém a nota); sem id = nova. */
  id: z.uuid().optional(),
  key: keySchema,
  name: z.string().trim().min(1, { error: "Dê um nome." }).max(120),
  maxScore: centi.min(1),
  group: keySchema.nullable().default(null),
  role: evaluationRoleSchema.default("regular"),
  dueOn: z.iso.date().nullable().default(null),
  /** Cria a tarefa no calendário para esta avaliação (precisa de data). */
  createTask: z.boolean().optional(),
});
export type EvaluationItemInput = z.input<typeof evaluationItemInputSchema>;

export const saveGradingBodySchema = z.object({
  rules: gradingRulesSchema,
  items: z
    .array(evaluationItemInputSchema)
    .min(1, { error: "Cadastre ao menos uma avaliação." })
    .max(60),
  source: z.enum(["manual", "ai"]).default("manual"),
});
export type SaveGradingBody = z.input<typeof saveGradingBodySchema>;

export const gradeStatusSchema = z.enum([
  "aprovado_por_nota",
  "em_curso",
  "em_exame",
  "sem_chance_direta",
  "reprovado_por_nota",
]);
export type GradeStatusDto = z.infer<typeof gradeStatusSchema>;

export const gradeSummarySchema = z.object({
  guaranteed: z.number().int(),
  partial: z.number().int().nullable(),
  maxPossible: z.number().int(),
  final: z.number().int().nullable(),
  afterExam: z.number().int().nullable(),
  needed: z
    .object({
      items: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          needed: z.number().int(),
          maxScore: z.number().int(),
        }),
      ),
    })
    .nullable(),
  neededOnExam: z.number().int().nullable(),
  status: gradeStatusSchema,
  graded: z.number().int(),
  total: z.number().int(),
});
export type GradeSummaryDto = z.infer<typeof gradeSummarySchema>;

export const evaluationItemSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  maxScore: z.number().int(),
  group: z.string().nullable(),
  role: evaluationRoleSchema,
  dueOn: z.iso.date().nullable(),
  score: z.number().int().nullable(),
  scoreSource: z.enum(["user", "moodle"]),
  externalGradeItemId: z.string().nullable(),
  /** Tarefa do calendário ligada a esta avaliação (a primeira, se houver). */
  task: z
    .object({
      id: z.uuid(),
      title: z.string(),
      status: z.enum(["pending", "completed", "not_completed"]),
    })
    .nullable(),
  version: z.number().int(),
});
export type EvaluationItemDto = z.infer<typeof evaluationItemSchema>;

export const subjectGradingSchema = z.object({
  subjectId: z.uuid(),
  scheme: z
    .object({
      rules: gradingRulesSchema,
      source: z.enum(["manual", "ai"]),
      version: z.number().int(),
    })
    .nullable(),
  items: z.array(evaluationItemSchema),
  summary: gradeSummarySchema.nullable(),
});
export type SubjectGrading = z.infer<typeof subjectGradingSchema>;

export const scoreBodySchema = z.object({
  /** Nota em centésimos; null apaga a nota. */
  score: centi.nullable(),
});

export const evaluationItemParamsSchema = z.object({
  id: z.uuid({ error: "Avaliação inválida." }),
});

export const GradesErrorCode = { invalid: "GRADING_INVALID" } as const;

export const GRADE_STATUS_LABEL: Record<GradeStatusDto, string> = {
  aprovado_por_nota: "Aprovado por nota",
  em_curso: "Em curso",
  em_exame: "Vai para o exame",
  sem_chance_direta: "Só pelo exame",
  reprovado_por_nota: "Reprovado por nota",
};
