import { bigint, integer, uuid } from "drizzle-orm/pg-core";
import { app } from "./_shared";

/**
 * Totais de faltas por matéria, sempre derivados de attendance_logs (nada é armazenado).
 * Definida em SQL na migration de segurança (security_invoker: respeita o RLS de quem consulta);
 * aqui só a forma, para consultas tipadas.
 */
export const subjectTotals = app
  .view("subject_totals", {
    subjectId: uuid().notNull(),
    userId: uuid().notNull(),
    unitsCounted: integer().notNull(),
    unitsExcused: integer().notNull(),
    unitsHeld: integer().notNull(),
    logsCount: bigint({ mode: "number" }).notNull(),
  })
  .existing();
