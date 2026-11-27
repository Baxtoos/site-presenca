import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, ownerId, pk, updatedAt, version } from "./_shared";
import { users } from "./identity";

/**
 * Regra de cálculo da nota de uma matéria (uma por matéria): escala, nota mínima, fórmula, grupos,
 * substitutiva, exame e arredondamento, validados pelo motor (packages/engine/src/grades) antes de
 * gravar. A nota nunca é guardada: é sempre calculada na hora. A FK composta com a matéria fica na
 * migration de segurança.
 */
export const gradingSchemes = app.table(
  "grading_schemes",
  {
    id: pk(),
    userId: ownerId().references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid().notNull(),
    rules: jsonb().notNull(),
    /** manual: o aluno montou; ai: veio do assistente (e o aluno confirmou). */
    source: text().notNull().default("manual"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("grading_schemes_subject_key").on(t.subjectId),
    check(
      "grading_schemes_rules_chk",
      sql`jsonb_typeof(${t.rules}) = 'object' and pg_column_size(${t.rules}) <= 20000`,
    ),
    check("grading_schemes_source_chk", sql`${t.source} in ('manual', 'ai')`),
  ],
);

/**
 * Avaliações da matéria (P1, Lista 3, Trabalho, Substitutiva, Exame) e a nota de cada uma, em
 * centésimos de ponto. `score_source = 'user'` marca nota lançada pelo aluno: a importação do
 * Moodle nunca sobrescreve.
 */
export const evaluationItems = app.table(
  "evaluation_items",
  {
    id: pk(),
    userId: ownerId(),
    subjectId: uuid().notNull(),
    /** Nome curto usado na fórmula (P1, Lista2). */
    key: text().notNull(),
    name: text().notNull(),
    maxScore: integer().notNull(),
    groupKey: text(),
    role: text().notNull().default("regular"),
    dueOn: date({ mode: "string" }),
    score: integer(),
    scoreSource: text().notNull().default("user"),
    scoredAt: timestamp({ withTimezone: true }),
    /** Item do livro de notas do Moodle ligado a esta avaliação. */
    externalGradeItemId: text(),
    position: smallint().notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("evaluation_items_id_user_key").on(t.id, t.userId),
    uniqueIndex("evaluation_items_subject_key_idx").on(t.subjectId, sql`lower(${t.key})`),
    index("evaluation_items_user_idx").on(t.userId),
    check("evaluation_items_key_chk", sql`char_length(${t.key}) between 1 and 30`),
    check("evaluation_items_name_chk", sql`char_length(btrim(${t.name})) between 1 and 120`),
    check("evaluation_items_max_chk", sql`${t.maxScore} between 1 and 10000`),
    check(
      "evaluation_items_score_chk",
      sql`${t.score} is null or ${t.score} between 0 and ${t.maxScore}`,
    ),
    check("evaluation_items_role_chk", sql`${t.role} in ('regular', 'substitute', 'exam')`),
    check("evaluation_items_source_chk", sql`${t.scoreSource} in ('user', 'moodle', 'suap')`),
    check("evaluation_items_scored_chk", sql`(${t.score} is null) = (${t.scoredAt} is null)`),
    check(
      "evaluation_items_external_chk",
      sql`${t.externalGradeItemId} is null or char_length(${t.externalGradeItemId}) <= 100`,
    ),
  ],
);
