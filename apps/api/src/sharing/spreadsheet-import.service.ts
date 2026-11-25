import { Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import type { SemesterImportBody, SemesterImportResult } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { isoWeekday } from "@presenca/engine";
import { eq, sql } from "drizzle-orm";
import { freeSemesterLabel } from "../academic/labels";
import { scheduleColumns, subjectColumns } from "../academic/mappers";
import { loadSummary } from "../academic/summary";
import { countsAsAbsence, missedFor } from "../attendance/attendance.mapper";
import { ClockService } from "../common/clock";
import { type IdempotentResult, IdempotencyService } from "../common/idempotency";
import { DbService } from "../database/db.service";
import { ThresholdAlerts } from "../notifications/threshold-alerts";

const { semesters, subjects, subjectSchedules, calendarExceptions, attendanceLogs, users } = schema;

/** Erro de validação apontando o item da planilha (o site mostra a linha certa). */
const invalid = (path: string, message: string) =>
  new UnprocessableEntityException({ code: "IMPORT_INVALID", errors: [{ path, message }] });

const brDate = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Importa um semestre a partir da planilha exportada pelo app: semestre, matérias com regras,
 * grade, feriados e registros de presença, numa transação só (nada fica pela metade). Os marcos
 * de aviso ficam em dia sem gerar avisos sobre faltas antigas.
 */
@Injectable()
export class SpreadsheetImportService {
  private readonly logger = new Logger(SpreadsheetImportService.name);

  constructor(
    private readonly db: DbService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: ClockService,
    private readonly thresholds: ThresholdAlerts,
  ) {}

  import(
    userId: string,
    body: SemesterImportBody,
    key: string,
  ): Promise<IdempotentResult<SemesterImportResult>> {
    return this.db.tx((tx) =>
      this.idempotency.run(tx, key, body, async () => ({
        status: 201,
        body: await this.importInTx(tx, userId, body),
      })),
    );
  }

  private async importInTx(
    tx: Tx,
    userId: string,
    body: SemesterImportBody,
  ): Promise<SemesterImportResult> {
    const { semester: sem } = body;
    if (sem.endsOn < sem.startsOn) {
      throw invalid("semester.endsOn", "O fim do semestre precisa ser depois do início.");
    }
    if (body.subjects.length === 0) {
      throw invalid("subjects", "A planilha não tem nenhuma matéria.");
    }
    const inside = (d: string) => d >= sem.startsOn && d <= sem.endsOn;
    const period = `${brDate(sem.startsOn)} a ${brDate(sem.endsOn)}`;

    const [me] = await tx.select({ timezone: users.timezone }).from(users);
    const today = this.clock.todayIn(me?.timezone ?? "America/Sao_Paulo");

    // ---- semestre
    const label = await freeSemesterLabel(tx, sem.label);
    const [hasCurrent] = await tx
      .select({ id: semesters.id })
      .from(semesters)
      .where(eq(semesters.isCurrent, true))
      .limit(1);
    const [semester] = await tx
      .insert(semesters)
      .values({
        userId,
        label,
        startsOn: sem.startsOn,
        endsOn: sem.endsOn,
        // Primeiro semestre do aluno já vira o atual; senão ele escolhe depois.
        isCurrent: !hasCurrent,
      })
      .returning({ id: semesters.id });
    const semesterId = semester!.id;

    // ---- matérias e grade (guarda os ids na ordem da planilha)
    const created: {
      id: string;
      unitsPerClass: number;
      schedules: { id: string; weekday: number; units: number }[];
    }[] = [];
    for (const s of body.subjects) {
      const [row] = await tx
        .insert(subjects)
        .values({ ...subjectColumns(s), userId: sql`app.current_user_id()`, semesterId })
        .returning({ id: subjects.id, unitsPerClass: subjects.unitsPerClass });
      const scheduleRows =
        s.schedules.length > 0
          ? await tx
              .insert(subjectSchedules)
              .values(
                s.schedules.map((x) => ({
                  ...scheduleColumns(x),
                  userId: sql`app.current_user_id()`,
                  subjectId: row!.id,
                })),
              )
              .returning({
                id: subjectSchedules.id,
                weekday: subjectSchedules.weekday,
                units: subjectSchedules.units,
              })
          : [];
      created.push({ id: row!.id, unitsPerClass: row!.unitsPerClass, schedules: scheduleRows });
    }

    // ---- feriados e dias sem aula
    const exceptions = body.exceptions.map((e, i) => {
      if (!inside(e.startsOn) || !inside(e.endsOn) || e.endsOn < e.startsOn) {
        throw invalid(`exceptions.${i}`, `"${e.label}" fica fora do semestre (${period}).`);
      }
      if (e.subjectIndex !== null && !created[e.subjectIndex]) {
        throw invalid(
          `exceptions.${i}.subjectIndex`,
          `"${e.label}" aponta para uma matéria que não existe.`,
        );
      }
      return {
        userId,
        semesterId,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        kind: e.kind,
        label: e.label,
        subjectId: e.subjectIndex === null ? null : created[e.subjectIndex]!.id,
      };
    });
    if (exceptions.length > 0) await tx.insert(calendarExceptions).values(exceptions);

    // ---- registros de presença (validados como no registro um a um)
    const seen = new Set<string>();
    const logs = body.attendance.map((a, i) => {
      const where = `Registro ${i + 1} (${brDate(a.classDate)})`;
      const subject = created[a.subjectIndex];
      if (!subject) throw invalid(`attendance.${i}.subjectIndex`, `${where}: matéria não existe.`);
      if (!inside(a.classDate)) {
        throw invalid(`attendance.${i}.classDate`, `${where}: fora do semestre (${period}).`);
      }
      if (a.classDate > today) {
        throw invalid(`attendance.${i}.classDate`, `${where}: data no futuro.`);
      }
      let scheduled: number;
      let scheduleId: string | null = null;
      if (a.scheduleIndex !== null) {
        const schedule = subject.schedules[a.scheduleIndex];
        if (!schedule) {
          throw invalid(
            `attendance.${i}.scheduleIndex`,
            `${where}: horário não existe nesta matéria.`,
          );
        }
        if (schedule.weekday !== isoWeekday(a.classDate)) {
          throw invalid(
            `attendance.${i}.scheduleIndex`,
            `${where}: o horário não acontece neste dia da semana.`,
          );
        }
        scheduled = schedule.units;
        scheduleId = schedule.id;
      } else {
        scheduled = a.unitsScheduled ?? subject.unitsPerClass;
      }
      if (a.status === "partial" && (a.unitsMissed ?? 0) >= scheduled) {
        throw invalid(
          `attendance.${i}.unitsMissed`,
          `${where}: falta parcial precisa ser menor que as ${scheduled} aulas do dia.`,
        );
      }
      const occurrence = `${a.subjectIndex}|${a.classDate}|${scheduleId ?? "extra"}`;
      if (seen.has(occurrence)) {
        throw invalid(`attendance.${i}`, `${where}: aula repetida na planilha.`);
      }
      seen.add(occurrence);
      const absence = countsAsAbsence(a.status);
      return {
        userId: sql`app.current_user_id()`,
        subjectId: subject.id,
        scheduleId,
        classDate: a.classDate,
        status: a.status,
        unitsScheduled: scheduled,
        unitsMissed: missedFor(a.status, scheduled, a.unitsMissed),
        isExcused: absence && a.isExcused,
        reason: absence ? (a.reason ?? null) : null,
        note: a.note ?? null,
        content: a.content ?? null,
      };
    });
    for (let i = 0; i < logs.length; i += 500) {
      await tx.insert(attendanceLogs).values(logs.slice(i, i + 500));
    }

    // ---- marcos de aviso em dia, sem avisar sobre faltas antigas
    for (const s of created) {
      const [row] = await tx.select().from(subjects).where(eq(subjects.id, s.id));
      await this.thresholds.sync(tx, row!, await loadSummary(tx, row!));
    }

    this.logger.log(
      `planilha importada: semestre ${semesterId}, ${created.length} matérias, ${logs.length} registros`,
    );
    return { semesterId, label, subjects: created.length, attendance: logs.length };
  }
}
