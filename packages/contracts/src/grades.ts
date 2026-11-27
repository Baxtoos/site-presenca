import { z } from "zod";

const keySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]{0,29}$/, {
    error: "Use um nome curto, sem espaços (ex.: P1, Lista2, Trabalho).",
  });
const centi = z.number().int().min(0).max(10_000);

const suapScore = z.number().min(0).max(1000).nullable();

export const suapGradesSchema = z.object({
  stages: z.array(z.object({ label: z.string().max(30), score: suapScore })).max(6),
  average: suapScore,
  finalExam: suapScore,
  finalGrade: suapScore,
  concept: z.string().max(20).nullable(),
  status: z.string().max(80).nullable(),
  assessments: z
    .array(
      z.object({
        stage: z.string().max(30),
        method: z.string().max(60).nullable(),
        code: z.string().max(20),
        kind: z.string().max(40).nullable(),
        description: z.string().max(120).nullable(),
        date: z.string().max(20).nullable(),
        weight: z.number().min(0).max(1000).nullable(),
        score: suapScore,
      }),
    )
    .max(40)
    .default([]),
});
export type SuapGrades = z.infer<typeof suapGradesSchema>;

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
  id: z.uuid().optional(),
  key: keySchema,
  name: z.string().trim().min(1, { error: "Dê um nome." }).max(120),
  maxScore: centi.min(1),
  group: keySchema.nullable().default(null),
  role: evaluationRoleSchema.default("regular"),
  dueOn: z.iso.date().nullable().default(null),
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
  scoreSource: z.enum(["user", "moodle", "suap"]),
  externalGradeItemId: z.string().nullable(),
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
  assistantAvailable: z.boolean(),
  moodleLinkable: z.boolean().default(false),
  official: suapGradesSchema.extend({ syncedAt: z.string() }).nullable().default(null),
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
  score: centi.nullable(),
  completeTask: z.boolean().optional(),
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

export const GRADING_AI_MAX_TURNS = 10;

export const gradingAssistantRequestSchema = z.object({
  conversationId: z.uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(2 * GRADING_AI_MAX_TURNS + 1)
    .refine((m) => m.at(-1)?.role === "user", { error: "A última mensagem precisa ser sua." }),
});
export type GradingAssistantRequest = z.infer<typeof gradingAssistantRequestSchema>;

export const gradingAssistantResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("question"), text: z.string(), remaining: z.number().int() }),
  z.object({
    type: z.literal("scheme"),
    summary: z.string(),
    proposal: saveGradingBodySchema,
    remaining: z.number().int(),
  }),
  z.object({
    type: z.literal("fallback"),
    reason: z.enum(["limit", "error", "unavailable"]),
    message: z.string(),
    draft: saveGradingBodySchema.partial().nullable(),
  }),
]);
export type GradingAssistantResponse = z.infer<typeof gradingAssistantResponseSchema>;

export const moodleGradeItemSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  grade: z.number().nullable(),
  max: z.number(),
  linkedTo: z.uuid().nullable(),
  suggested: z.uuid().nullable(),
});
export type MoodleGradeItemDto = z.infer<typeof moodleGradeItemSchema>;

export const moodleGradesSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  courseKey: z.string().nullable(),
  items: z.array(moodleGradeItemSchema),
});
export type MoodleGrades = z.infer<typeof moodleGradesSchema>;

export const moodleGradeLinksBodySchema = z.object({
  links: z
    .array(
      z.object({
        evaluationItemId: z.uuid({ error: "Avaliação inválida." }),
        externalGradeItemId: z.string().min(1).max(100).nullable(),
      }),
    )
    .max(60),
});
export type MoodleGradeLinksBody = z.infer<typeof moodleGradeLinksBodySchema>;

export const gradesOverviewSchema = z.object({
  subjects: z.array(
    z.object({
      subjectId: z.uuid(),
      name: z.string(),
      passing: z.number().int().nullable(),
      summary: gradeSummarySchema.nullable(),
      official: suapGradesSchema.extend({ syncedAt: z.string() }).nullable().default(null),
      scored: z.number().int(),
      total: z.number().int(),
    }),
  ),
});
export type GradesOverview = z.infer<typeof gradesOverviewSchema>;
