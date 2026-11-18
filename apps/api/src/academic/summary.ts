import { schema, type Tx } from "@presenca/db";
import { type AttendanceTotals, summarize, type SubjectSummary } from "@presenca/engine";
import { eq } from "drizzle-orm";
import { NO_ATTENDANCE, rulesFromRow } from "./mappers";

export type SubjectRow = typeof schema.subjects.$inferSelect;

/** Totais registrados da matéria (view subject_totals: sempre derivados dos registros). */
export async function loadTotals(tx: Tx, subjectId: string): Promise<AttendanceTotals> {
  const [row] = await tx
    .select()
    .from(schema.subjectTotals)
    .where(eq(schema.subjectTotals.subjectId, subjectId));
  return row
    ? { unitsCounted: row.unitsCounted, unitsExcused: row.unitsExcused, unitsHeld: row.unitsHeld }
    : NO_ATTENDANCE;
}

/** Resumo da matéria recalculado agora, na mesma transação (vê o que acabou de ser gravado). */
export async function loadSummary(tx: Tx, subject: SubjectRow): Promise<SubjectSummary> {
  return summarize(rulesFromRow(subject), await loadTotals(tx, subject.id));
}
