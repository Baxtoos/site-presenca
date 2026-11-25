import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateSubjectBody,
  Schedule,
  ScheduleBody,
  Subject,
  SubjectBody,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import type { AttendanceTotals } from "@presenca/engine";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { assertVersioned } from "../common/versioning";
import { DbService } from "../database/db.service";
import { ThresholdAlerts } from "../notifications/threshold-alerts";
import { NO_ATTENDANCE, scheduleColumns, subjectColumns, toSchedule, toSubject } from "./mappers";
import { SemestersService } from "./semesters.service";
import { inOrder } from "../common/in-order";
import { gradeStatusesTx } from "../grades/status";

const { subjects, subjectSchedules, subjectTotals } = schema;

const subjectNotFound = () => new NotFoundException({ detail: "Matéria não encontrada." });

@Injectable()
export class SubjectsService {
  constructor(
    private readonly db: DbService,
    private readonly semesters: SemestersService,
    private readonly alerts: ThresholdAlerts,
  ) {}

  list(semesterId: string): Promise<Subject[]> {
    return this.db.tx(async (tx) => {
      await this.semesters.load(tx, semesterId);
      const rows = await tx
        .select()
        .from(subjects)
        .where(eq(subjects.semesterId, semesterId))
        .orderBy(asc(subjects.name));
      return this.withDetails(tx, rows);
    });
  }

  get(id: string): Promise<Subject> {
    return this.db.tx((tx) => this.load(tx, id));
  }

  create(semesterId: string, body: CreateSubjectBody): Promise<Subject> {
    return this.db.tx(async (tx) => {
      await this.semesters.load(tx, semesterId);
      const [row] = await tx
        .insert(subjects)
        .values({ ...subjectColumns(body), userId: sql`app.current_user_id()`, semesterId })
        .returning();
      const schedules =
        body.schedules.length === 0
          ? []
          : await tx
              .insert(subjectSchedules)
              .values(
                body.schedules.map((s) => ({
                  ...scheduleColumns(s),
                  userId: sql`app.current_user_id()`,
                  subjectId: row!.id,
                })),
              )
              .returning();
      return toSubject(row!, sortSchedules(schedules), NO_ATTENDANCE);
    });
  }

  replace(id: string, expectedVersion: number, body: SubjectBody): Promise<Subject> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .update(subjects)
        .set(subjectColumns(body))
        .where(and(eq(subjects.id, id), eq(subjects.version, expectedVersion)))
        .returning({ id: subjects.id });
      await assertVersioned(rows, () => this.exists(tx, id), "Matéria não encontrada.");
      // Regras novas mudam o limite: pode cruzar (ou voltar abaixo de) um marco sem nenhuma falta nova.
      const subject = await this.load(tx, id);
      const [row] = await tx.select().from(subjects).where(eq(subjects.id, id));
      await this.alerts.evaluate(tx, row!, subject.summary);
      return subject;
    });
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    await this.db.tx(async (tx) => {
      const rows = await tx
        .delete(subjects)
        .where(and(eq(subjects.id, id), eq(subjects.version, expectedVersion)))
        .returning({ id: subjects.id });
      await assertVersioned(rows, () => this.exists(tx, id), "Matéria não encontrada.");
    });
  }

  // ---------------------------------------------------------------- grade

  addSchedule(subjectId: string, body: ScheduleBody): Promise<Schedule> {
    return this.db.tx(async (tx) => {
      if (!(await this.exists(tx, subjectId))) throw subjectNotFound();
      const [row] = await tx
        .insert(subjectSchedules)
        .values({ ...scheduleColumns(body), userId: sql`app.current_user_id()`, subjectId })
        .returning();
      return toSchedule(row!);
    });
  }

  replaceSchedule(
    subjectId: string,
    scheduleId: string,
    expectedVersion: number,
    body: ScheduleBody,
  ): Promise<Schedule> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .update(subjectSchedules)
        .set(scheduleColumns(body))
        .where(
          and(
            eq(subjectSchedules.id, scheduleId),
            eq(subjectSchedules.subjectId, subjectId),
            eq(subjectSchedules.version, expectedVersion),
          ),
        )
        .returning();
      const row = await assertVersioned(
        rows,
        async () => {
          const [found] = await tx
            .select({ id: subjectSchedules.id })
            .from(subjectSchedules)
            .where(
              and(eq(subjectSchedules.id, scheduleId), eq(subjectSchedules.subjectId, subjectId)),
            );
          return found !== undefined;
        },
        "Horário não encontrado.",
      );
      return toSchedule(row);
    });
  }

  async removeSchedule(subjectId: string, scheduleId: string): Promise<void> {
    const rows = await this.db.tx((tx) =>
      tx
        .delete(subjectSchedules)
        .where(and(eq(subjectSchedules.id, scheduleId), eq(subjectSchedules.subjectId, subjectId)))
        .returning({ id: subjectSchedules.id }),
    );
    if (rows.length === 0) throw new NotFoundException({ detail: "Horário não encontrado." });
  }

  // ---------------------------------------------------------------- internos

  async load(tx: Tx, id: string): Promise<Subject> {
    const rows = await tx.select().from(subjects).where(eq(subjects.id, id));
    if (rows.length === 0) throw subjectNotFound();
    const [subject] = await this.withDetails(tx, rows);
    return subject!;
  }

  private async exists(tx: Tx, id: string): Promise<boolean> {
    const [row] = await tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, id));
    return row !== undefined;
  }

  /** Junta grade e totais (view subject_totals) às matérias e calcula o resumo de cada uma. */
  private async withDetails(tx: Tx, rows: (typeof subjects.$inferSelect)[]): Promise<Subject[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [schedules, totals] = await inOrder([
      tx.select().from(subjectSchedules).where(inArray(subjectSchedules.subjectId, ids)),
      tx.select().from(subjectTotals).where(inArray(subjectTotals.subjectId, ids)),
    ]);
    const gradeStatuses = await gradeStatusesTx(tx, ids);
    const totalsById = new Map<string, AttendanceTotals>(
      totals.map((t) => [
        t.subjectId,
        { unitsCounted: t.unitsCounted, unitsExcused: t.unitsExcused, unitsHeld: t.unitsHeld },
      ]),
    );
    return rows.map((row) =>
      toSubject(
        row,
        sortSchedules(schedules.filter((s) => s.subjectId === row.id)),
        totalsById.get(row.id) ?? NO_ATTENDANCE,
        gradeStatuses.get(row.id) ?? null,
      ),
    );
  }
}

/** Ordem da semana: segunda primeiro, depois pelo horário. */
function sortSchedules<T extends { weekday: number; startsAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
}
