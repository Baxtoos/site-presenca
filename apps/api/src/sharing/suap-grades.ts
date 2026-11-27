import type { GradePostedPayload, SuapGrades } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { eq } from "drizzle-orm";

const { subjects, notificationPreferences, notificationLogs, users } = schema;

type NewLog = typeof notificationLogs.$inferInsert;

/** Notas do boletim em pares (rótulo, nota), na ordem em que aparecem. */
function entries(g: SuapGrades): [string, number | null][] {
  return [
    ...g.stages.map((s): [string, number | null] => [s.label, s.score]),
    ["Média", g.average],
    ["Nota da avaliação final (NAF)", g.finalExam],
    ["Média final", g.finalGrade],
  ];
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
  if (!previous) return 0;

  const before = new Map(entries(previous));
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
