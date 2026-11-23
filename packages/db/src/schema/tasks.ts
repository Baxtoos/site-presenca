import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, ownerId, pk, updatedAt, version } from "./_shared";
import { taskStatus } from "./enums";
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
    remindBeforeMinutes: integer().notNull().default(1440),
    status: taskStatus().notNull().default("pending"),
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
    check(
      "tasks_remind_chk",
      sql`${t.remindBeforeMinutes} in (${sql.raw(TASK_REMIND_OPTIONS.join(", "))})`,
    ),
    check("tasks_resolved_chk", sql`(${t.status} = 'pending') = (${t.resolvedAt} is null)`),
  ],
);
