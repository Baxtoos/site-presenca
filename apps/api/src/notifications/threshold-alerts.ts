import { Injectable } from "@nestjs/common";
import type { ThresholdPayload } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import {
  evaluateThresholds,
  type SubjectSummary,
  THRESHOLDS,
  type ThresholdPct,
  type ThresholdState,
} from "@presenca/engine";
import { eq, sql } from "drizzle-orm";
import type { SubjectRow } from "../academic/summary";
import { inOrder } from "../common/in-order";

const { subjects, subjectThresholdState, notificationPreferences, notificationLogs, users } =
  schema;

type NewLog = typeof notificationLogs.$inferInsert;

/**
 * Marcos de alerta (50/75/90/100% do limite). Roda DENTRO da transação que mudou os números
 * (registro, correção, exclusão ou novas regras da matéria): o alerta e o dado que o causou são
 * gravados juntos ou nenhum dos dois. O envio fica com o worker, acordado pelo NOTIFY do commit.
 */
@Injectable()
export class ThresholdAlerts {
  /**
   * Só atualiza o estado dos marcos, sem gerar aviso. Para quando os números chegam de uma vez
   * (importação de planilha): os marcos já passados ficam como "já avisados", e só um marco novo
   * a partir daqui gera aviso.
   */
  sync(tx: Tx, subject: SubjectRow, summary: SubjectSummary): Promise<void> {
    return this.evaluate(tx, subject, summary, { silent: true });
  }

  async evaluate(
    tx: Tx,
    subject: SubjectRow,
    summary: SubjectSummary,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    // Uma avaliação por matéria por vez: duas correções simultâneas não geram alerta em dobro.
    await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subject.id))
      .for("update");

    const [rows, [prefs]] = await inOrder([
      tx
        .select()
        .from(subjectThresholdState)
        .where(eq(subjectThresholdState.subjectId, subject.id)),
      tx.select().from(notificationPreferences),
    ]);
    const current: ThresholdState[] = rows.map((r) => ({
      pct: r.thresholdPct as ThresholdPct,
      armed: r.armed,
      cycle: r.cycle,
    }));
    const result = evaluateThresholds(
      summary.consumptionPct,
      current,
      prefs?.thresholds ?? THRESHOLDS,
    );

    for (const change of result.changes) {
      await tx
        .insert(subjectThresholdState)
        .values({
          subjectId: subject.id,
          userId: subject.userId,
          thresholdPct: change.pct,
          armed: change.armed,
          cycle: change.cycle,
          lastCrossedAt: change.armed ? null : sql`now()`,
        })
        .onConflictDoUpdate({
          target: [subjectThresholdState.subjectId, subjectThresholdState.thresholdPct],
          set: {
            armed: change.armed,
            cycle: change.cycle,
            ...(change.armed ? {} : { lastCrossedAt: sql`now()` }),
          },
        });
    }

    // Matéria arquivada continua com o estado em dia, mas não incomoda ninguém.
    if (!result.notify || subject.archivedAt || options.silent) return;

    const [user] = await tx.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users);
    const emailOn = prefs?.emailEnabled ?? true;
    const pushOn = prefs?.pushEnabled ?? false;

    const base = (state: ThresholdState): Omit<NewLog, "channel"> => {
      const payload: ThresholdPayload = {
        subjectName: subject.name,
        thresholdPct: state.pct,
        absentUnits: summary.absentUnits,
        maxUnits: summary.maxAbsenceUnits,
        remainingUnits: summary.remainingUnits,
        remainingClasses: summary.remainingClasses,
      };
      return {
        userId: subject.userId,
        subjectId: subject.id,
        kind: "threshold",
        thresholdPct: state.pct,
        cycle: state.cycle,
        dedupeKey: `threshold:${subject.id}:${state.pct}:${state.cycle}`,
        payload,
      };
    };

    const top = base(result.notify);
    const logs: NewLog[] = [
      // A central recebe na hora (não depende do worker).
      { ...top, channel: "in_app", status: "sent", sentAt: new Date() },
      {
        ...top,
        channel: "email",
        ...(emailOn && user?.emailVerifiedAt
          ? { status: "pending" }
          : {
              status: "skipped",
              lastError: emailOn ? "e-mail não confirmado" : "e-mail desligado nas preferências",
            }),
      },
      {
        ...top,
        channel: "push",
        ...(pushOn
          ? { status: "pending" }
          : { status: "skipped", lastError: "push desligado nas preferências" }),
      },
      // Marcos menores cruzados no mesmo salto: ficam no histórico, sem aparecer nem ser enviados.
      ...result.skipped.map((s): NewLog => ({
        ...base(s),
        channel: "in_app",
        status: "skipped",
        lastError: `coberto pelo alerta de ${result.notify!.pct}%`,
      })),
    ];
    await tx
      .insert(notificationLogs)
      .values(logs)
      .onConflictDoNothing({
        target: [notificationLogs.dedupeKey, notificationLogs.channel],
      });
  }
}
