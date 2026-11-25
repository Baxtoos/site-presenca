import { type GradeStatusDto, saveGradingBodySchema } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { type EvaluationItem, summarizeGrades } from "@presenca/engine";
import { inArray } from "drizzle-orm";

const { gradingSchemes, evaluationItems } = schema;

/** Situação da nota de cada matéria que tem regra de cálculo (para os cards das matérias). */
export async function gradeStatusesTx(
  tx: Tx,
  subjectIds: string[],
): Promise<Map<string, GradeStatusDto>> {
  const out = new Map<string, GradeStatusDto>();
  if (subjectIds.length === 0) return out;
  const schemes = await tx
    .select({ subjectId: gradingSchemes.subjectId, rules: gradingSchemes.rules })
    .from(gradingSchemes)
    .where(inArray(gradingSchemes.subjectId, subjectIds));
  if (schemes.length === 0) return out;
  const items = await tx
    .select()
    .from(evaluationItems)
    .where(
      inArray(
        evaluationItems.subjectId,
        schemes.map((s) => s.subjectId),
      ),
    );
  for (const s of schemes) {
    const rules = saveGradingBodySchema.shape.rules.safeParse(s.rules);
    if (!rules.success) continue;
    const engineItems: EvaluationItem[] = items
      .filter((i) => i.subjectId === s.subjectId)
      .map((i) => ({
        key: i.key,
        name: i.name,
        maxScore: i.maxScore,
        group: i.groupKey,
        role: i.role as EvaluationItem["role"],
        score: i.score,
      }));
    try {
      out.set(s.subjectId, summarizeGrades(rules.data, engineItems).status);
    } catch {
      // Regra que o motor não consegue calcular: o card fica sem situação de nota.
    }
  }
  return out;
}
