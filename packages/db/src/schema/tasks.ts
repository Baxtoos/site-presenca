import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, ownerId, pk, updatedAt, version } from "./_shared";
import { taskSource, taskStatus, taskStatusSource } from "./enums";
import { users } from "./identity";

/** Antecedências permitidas para o aviso (minutos antes do prazo). */
export const TASK_REMIND_OPTIONS = [60, 180, 720, 1440, 2880] as const;

/**
 * Tarefas e entregas do aluno. `subject_id` é opcional; a FK composta (subject_id, user_id) com
 * ON DELETE SET NULL (subject_id) fica na migration de segurança: apagar a matéria mantém a tarefa.
 */
export const tasks = app.table(
  "tasks",
  {
    id: pk(),
    userId: ownerId().references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid(),
    title: text().notNull(),
    notes: text(),
    /** Prazo de envio (instante; a tela informa data e hora no fuso do aluno). */
    dueAt: timestamp({ withTimezone: true }).notNull(),
    /** Antecedência do aviso; null = sem aviso. */
    remindBeforeMinutes: integer().default(1440),
    status: taskStatus().notNull().default("pending"),
    /** "user" quando o aluno marcou: a sincronização nunca sobrescreve. */
    statusSource: taskStatusSource().notNull().default("user"),
    source: taskSource().notNull().default("manual"),
    /** Identificador na origem (UID do .ics, id da atividade no Moodle); null nas manuais. */
    externalUid: text(),
    /** Link para a atividade original (só https). */
    externalUrl: text(),
    /** Turma de origem no Moodle (moodle_course_mappings.course_key), para trocar a matéria em lote. */
    externalCourseKey: text(),
    /** Quando virou concluída ou não concluída (null enquanto pendente). */
    resolvedAt: timestamp({ withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Alvo da FK composta da outbox (task_id, user_id).
    unique("tasks_id_user_key").on(t.id, t.userId),
    index("tasks_user_due_idx").on(t.userId, t.dueAt),
    // Worker: pendentes com prazo nas próximas 48 h (a maior antecedência permitida).
    index("tasks_pending_due_idx")
      .on(t.dueAt)
      .where(sql`${t.status} = 'pending'`),
    check("tasks_title_chk", sql`char_length(btrim(${t.title})) between 1 and 200`),
    check("tasks_notes_chk", sql`${t.notes} is null or char_length(${t.notes}) <= 2000`),
    // Uma tarefa importada por origem: a sincronização reconcilia por (user_id, source, external_uid).
    uniqueIndex("tasks_external_uid_key")
      .on(t.userId, t.source, t.externalUid)
      .where(sql`${t.externalUid} is not null`),
    check(
      "tasks_remind_chk",
      sql`${t.remindBeforeMinutes} is null or ${t.remindBeforeMinutes} in (${sql.raw(TASK_REMIND_OPTIONS.join(", "))})`,
    ),
    check(
      "tasks_external_url_chk",
      sql`${t.externalUrl} is null or (${t.externalUrl} ~ '^https://' and char_length(${t.externalUrl}) <= 2000)`,
    ),
    check(
      "tasks_external_course_chk",
      sql`${t.externalCourseKey} is null or (${t.source} <> 'manual' and char_length(${t.externalCourseKey}) <= 200)`,
    ),
    check(
      "tasks_external_uid_chk",
      sql`(${t.source} = 'manual') = (${t.externalUid} is null) and (${t.externalUid} is null or char_length(${t.externalUid}) <= 500)`,
    ),
    check("tasks_resolved_chk", sql`(${t.status} = 'pending') = (${t.resolvedAt} is null)`),
  ],
);
