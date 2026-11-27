import type { GradePostedPayload, SuapGrades } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { and, eq } from "drizzle-orm";

const {
  subjects,
  notificationPreferences,
  notificationLogs,
  users,
  gradingSchemes,
  evaluationItems,
} = schema;

type NewLog = typeof notificationLogs.$inferInsert;

/** Notas do boletim em pares (rótulo, nota), na ordem em que aparecem. */
function entries(g: SuapGrades): [string, number | null][] {
  return [
    ...g.stages.map((s): [string, number | null] => [s.label, s.score]),
    ["Média", g.average],
    ["Nota da avaliação final (NAF)", g.finalExam],
    ["Média final", g.finalGrade],
    ...g.assessments.map((a): [string, number | null] => [`${a.code} (${a.stage})`, a.score]),
  ];
}

const isFinalStage = (stage: string) => /final/i.test(stage);

/**
 * Leva as notas do "Detalhar" do SUAP para as avaliações da matéria: a avaliação com a mesma sigla
 * (ex.: A1) recebe a nota da etapa normal, e o exame recebe a da "Etapa Final". Só preenche nota
 * vazia ou que já veio do SUAP (score_source = 'suap'): nota lançada pelo aluno nunca é trocada.
 * A nota é convertida para a nota máxima da avaliação, na escala da regra (10 ou 100).
 */
export async function applySuapScoresTx(
  tx: Tx,
  subjectId: string,
  grades: SuapGrades | null,
  now: Date,
): Promise<number> {
  const scored = (grades?.assessments ?? []).filter((a) => a.score !== null);
  if (scored.length === 0) return 0;
  const [scheme] = await tx
    .select({ rules: gradingSchemes.rules })
    .from(gradingSchemes)
    .where(eq(gradingSchemes.subjectId, subjectId));
  if (!scheme) return 0;
  const scale = (scheme.rules as { scale?: number }).scale === 100 ? 100 : 10;
  const items = await tx
    .select({
      id: evaluationItems.id,
      key: evaluationItems.key,
      role: evaluationItems.role,
      maxScore: evaluationItems.maxScore,
      score: evaluationItems.score,
      scoreSource: evaluationItems.scoreSource,
    })
    .from(evaluationItems)
    .where(eq(evaluationItems.subjectId, subjectId));
  let changed = 0;
  for (const a of scored) {
    const target = isFinalStage(a.stage)
      ? items.find((i) => i.role === "exam")
      : items.find((i) => i.role !== "exam" && i.key.toLowerCase() === a.code.toLowerCase());
    if (!target || (target.score !== null && target.scoreSource !== "suap")) continue;
    const centi = Math.min(
      target.maxScore,
      Math.max(0, Math.round((a.score! / scale) * target.maxScore)),
    );
    if (centi === target.score) continue;
    await tx
      .update(evaluationItems)
      .set({ score: centi, scoreSource: "suap", scoredAt: now })
      .where(and(eq(evaluationItems.id, target.id), eq(evaluationItems.subjectId, subjectId)));
    target.score = centi;
    target.scoreSource = "suap";
    changed++;
  }
  return changed;
}

/**
 * Guarda as notas do boletim do SUAP na matéria e avisa "Nota nova" (no app, push e e-mail,
 * conforme as preferências) para cada nota que apareceu ou mudou desde a última sincronização.
 * Na primeira vez não avisa: seria um aviso por nota já conhecida. Sem notas no envio (favorito
 * antigo), não mexe em nada.
 */
export async function saveSuapGradesTx(
  tx: Tx,
  input: {
    subjectId: string;
    subjectName: string;
    userId: string;
    previous: SuapGrades | null;
    next: SuapGrades | null;
    now: Date;
  },
): Promise<number> {
  const { next, previous } = input;
  if (!next) return 0;
  await tx
    .update(subjects)
    .set({ suapGrades: next, suapGradesAt: input.now })
    .where(eq(subjects.id, input.subjectId));
  await applySuapScoresTx(tx, input.subjectId, next, input.now);
  if (!previous) return 0;

  // Notas guardadas antes da parte 2 não têm avaliações: o padrão vazio vale.
  const before = new Map(entries({ ...previous, assessments: previous.assessments ?? [] }));
  const posted = entries(next).filter(
    ([label, score]) => score !== null && before.get(label) !== score,
  );
  if (posted.length === 0) return 0;

  const [prefs] = await tx.select().from(notificationPreferences);
  const [user] = await tx.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users);
  const emailOn = (prefs?.emailEnabled ?? true) && !!user?.emailVerifiedAt;
  const pushOn = prefs?.pushEnabled ?? false;
  const logs: NewLog[] = posted.flatMap(([label, score]) => {
    const centi = Math.round(score! * 100);
    const payload: GradePostedPayload = {
      subjectName: input.subjectName,
      itemName: label,
      score: centi,
      // Escala do curso: até 10 (ex.: 7,5) ou até 100 (ex.: 75).
      maxScore: score! <= 10 ? 1000 : 10000,
      source: "suap",
    };
    const base = {
      userId: input.userId,
      subjectId: input.subjectId,
      kind: "grade_posted" as const,
      dedupeKey: `grade_posted:suap:${input.subjectId}:${label}:${centi}`,
      payload,
    };
    return [
      { ...base, channel: "in_app", status: "sent", sentAt: input.now },
      emailOn
        ? { ...base, channel: "email", status: "pending" }
        : {
            ...base,
            channel: "email",
            status: "skipped",
            lastError: "e-mail desligado ou não confirmado",
          },
      pushOn
        ? { ...base, channel: "push", status: "pending" }
        : {
            ...base,
            channel: "push",
            status: "skipped",
            lastError: "push desligado nas preferências",
          },
    ];
  });
  await tx
    .insert(notificationLogs)
    .values(logs)
    .onConflictDoNothing({ target: [notificationLogs.dedupeKey, notificationLogs.channel] });
  return posted.length;
}
