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

// ---------------------------------------------------------------- nota oficial do SUAP

/** Nota como o SUAP mostra (escala do curso, ex.: 7.5 ou 75); null = ainda sem nota. */
const suapScore = z.number().min(0).max(1000).nullable();

/** Notas do boletim do SUAP de uma disciplina, como o professor lançou. */
export const suapGradesSchema = z.object({
  /** Nota de cada etapa ("Etapa 1", "Etapa 2"…). */
  stages: z.array(z.object({ label: z.string().max(30), score: suapScore })).max(6),
  /** MÉDIA. */
  average: suapScore,
  /** NAF: nota da avaliação final (exame). */
  finalExam: suapScore,
  /** MFD: média final da disciplina. */
  finalGrade: suapScore,
  /** Conceito, quando o curso usa conceito no lugar da média final (ex.: "A"). */
  concept: z.string().max(20).nullable(),
  /** SITUAÇÃO no boletim (ex.: "Cursando", "Aprovado"). */
  status: z.string().max(80).nullable(),
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
  /** O assistente de IA está ligado neste servidor (sem a chave, só o editor manual). */
  assistantAvailable: z.boolean(),
  /** Moodle com token e a turma ligada a esta matéria: dá para ligar as avaliações às do Moodle. */
  moodleLinkable: z.boolean().default(false),
  /** Notas oficiais do boletim do SUAP (null sem favorito do SUAP). Default: tolera API antiga. */
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
  /** Nota em centésimos; null apaga a nota. */
  score: centi.nullable(),
  /** Também marca como concluída a tarefa ligada que ainda está pendente. */
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

// ---------------------------------------------------------------- assistente de IA

/** Máximo de chamadas à IA por conversa (perguntas + a resposta final). */
export const GRADING_AI_MAX_TURNS = 10;

export const gradingAssistantRequestSchema = z.object({
  /** Gerado pelo navegador ao abrir o assistente; o limite de 10 conta por conversa. */
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
  /** A IA precisa saber mais: mostra a pergunta. */
  z.object({ type: z.literal("question"), text: z.string(), remaining: z.number().int() }),
  /** Regra pronta para o aluno conferir (nada é salvo sem ele confirmar). */
  z.object({
    type: z.literal("scheme"),
    summary: z.string(),
    proposal: saveGradingBodySchema,
    remaining: z.number().int(),
  }),
  /**
   * Não deu (limite de perguntas, erro ou demora da IA): a tela abre o editor manual, já com o
   * rascunho do que a IA entendeu, se houver.
   */
  z.object({
    type: z.literal("fallback"),
    reason: z.enum(["limit", "error", "unavailable"]),
    message: z.string(),
    draft: saveGradingBodySchema.partial().nullable(),
  }),
]);
export type GradingAssistantResponse = z.infer<typeof gradingAssistantResponseSchema>;

// ---------------------------------------------------------------- notas do Moodle

export const moodleGradeItemSchema = z.object({
  /** Identificador do item no Moodle (guardado em externalGradeItemId). */
  externalId: z.string(),
  name: z.string(),
  /** Nota na escala do item no Moodle (null = ainda sem nota). */
  grade: z.number().nullable(),
  max: z.number(),
  /** Avaliação do app já ligada a este item. */
  linkedTo: z.uuid().nullable(),
  /** Sugestão (mesmo nome) quando ainda não está ligado. */
  suggested: z.uuid().nullable(),
});
export type MoodleGradeItemDto = z.infer<typeof moodleGradeItemSchema>;

export const moodleGradesSchema = z.object({
  available: z.boolean(),
  /** Por que não dá para ligar (sem token, turma não ligada, Moodle fora do ar). */
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
        /** null desliga a avaliação do Moodle (a nota fica como do aluno). */
        externalGradeItemId: z.string().min(1).max(100).nullable(),
      }),
    )
    .max(60),
});
export type MoodleGradeLinksBody = z.infer<typeof moodleGradeLinksBodySchema>;

// ---------------------------------------------------------------- visão do semestre (aba Notas)

export const gradesOverviewSchema = z.object({
  subjects: z.array(
    z.object({
      subjectId: z.uuid(),
      name: z.string(),
      /** null: sem regra de cálculo. */
      passing: z.number().int().nullable(),
      summary: gradeSummarySchema.nullable(),
      official: suapGradesSchema.extend({ syncedAt: z.string() }).nullable().default(null),
      scored: z.number().int(),
      total: z.number().int(),
    }),
  ),
});
export type GradesOverview = z.infer<typeof gradesOverviewSchema>;
