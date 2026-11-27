import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  AttendanceErrorCode,
  type AttendanceDeleted,
  type AttendanceList,
  type AttendanceListQuery,
  type AttendanceResult,
  type CreateAttendanceBody,
  type UpdateAttendanceBody,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { isoWeekday } from "@presenca/engine";
import { and, desc, eq, sql } from "drizzle-orm";
import { loadSummary, type SubjectRow } from "../academic/summary";
import { isUniqueViolation } from "../auth/user-mapper";
import { ClockService } from "../common/clock";
import { type IdempotentResult, IdempotencyService } from "../common/idempotency";
import { assertVersioned } from "../common/versioning";
import { DbService } from "../database/db.service";
import { ThresholdAlerts } from "../notifications/threshold-alerts";
import {
  type AttendanceRow,
  brDate,
  countsAsAbsence,
  missedFor,
  toRecord,
} from "./attendance.mapper";

const { attendanceLogs, subjects, semesters, subjectSchedules, users } = schema;

const invalid = (code: string, path: string, message: string) =>
  new UnprocessableEntityException({ code, errors: [{ path, message }] });

const fieldError = (path: string, message: string) =>
  new UnprocessableEntityException({ errors: [{ path, message }] });

const attendanceNotFound = () => new NotFoundException({ detail: "Registro não encontrado." });

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DbService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: ClockService,
    private readonly alerts: ThresholdAlerts,
  ) {}

  private async summarizeAndAlert(tx: Tx, subject: SubjectRow) {
    const summary = await loadSummary(tx, subject);
    await this.alerts.evaluate(tx, subject, summary);
    return summary;
  }

  create(body: CreateAttendanceBody, key: string): Promise<IdempotentResult<AttendanceResult>> {
    return this.db.tx((tx) =>
      this.idempotency.run(tx, key, body, async () => ({
        status: 201,
        body: await this.createInTx(tx, body),
      })),
    );
  }

  private async createInTx(tx: Tx, body: CreateAttendanceBody): Promise<AttendanceResult> {
    const [found] = await tx
      .select({ subject: subjects, semester: semesters })
      .from(subjects)
      .innerJoin(semesters, eq(semesters.id, subjects.semesterId))
      .where(eq(subjects.id, body.subjectId));
    if (!found) throw new NotFoundException({ detail: "Matéria não encontrada." });
    const { subject, semester } = found;

    // Trava a matéria: dois registros simultâneos (dois celulares) viram fila, não corrida.
    await tx.execute(
      sql`select 1 from ${subjects} where ${subjects.id} = ${subject.id} for update`,
    );

    const today = await this.todayFor(tx);
    if (body.classDate > today) {
      throw invalid(
        AttendanceErrorCode.futureDate,
        "classDate",
        "Não dá para registrar presença numa data futura.",
      );
    }
    if (body.classDate < semester.startsOn || body.classDate > semester.endsOn) {
      throw invalid(
        AttendanceErrorCode.outOfSemester,
        "classDate",
        `Esta data fica fora do semestre (${brDate(semester.startsOn)} a ${brDate(semester.endsOn)}).`,
      );
    }

    let scheduled: number;
    if (body.scheduleId) {
      const [schedule] = await tx
        .select()
        .from(subjectSchedules)
        .where(
          and(eq(subjectSchedules.id, body.scheduleId), eq(subjectSchedules.subjectId, subject.id)),
        );
      if (!schedule) {
        throw invalid(
          AttendanceErrorCode.scheduleNotFound,
          "scheduleId",
          "Este horário não é desta matéria.",
        );
      }
      if (schedule.weekday !== isoWeekday(body.classDate)) {
        throw invalid(
          AttendanceErrorCode.scheduleNotFound,
          "scheduleId",
          "Este horário não acontece neste dia da semana.",
        );
      }
      scheduled = schedule.units;
    } else {
      scheduled = body.unitsScheduled ?? subject.unitsPerClass;
    }

    if (body.status === "partial" && (body.unitsMissed ?? 0) >= scheduled) {
      throw fieldError(
        "unitsMissed",
        scheduled === 1
          ? "Com 1 aula só no dia, não há falta parcial: marque falta total."
          : `Num dia de ${scheduled} aulas, a falta parcial vai de 1 a ${scheduled - 1}.`,
      );
    }

    const scheduleFilter = body.scheduleId
      ? eq(attendanceLogs.scheduleId, body.scheduleId)
      : sql`${attendanceLogs.scheduleId} is null`;
    const [existing] = await tx
      .select({ id: attendanceLogs.id })
      .from(attendanceLogs)
      .where(
        and(
          eq(attendanceLogs.subjectId, subject.id),
          eq(attendanceLogs.classDate, body.classDate),
          scheduleFilter,
        ),
      );
    if (existing) throw this.conflict(existing.id);

    const absence = countsAsAbsence(body.status);
    let row: AttendanceRow;
    try {
      [row] = (await tx
        .insert(attendanceLogs)
        .values({
          userId: sql`app.current_user_id()`,
          subjectId: subject.id,
          scheduleId: body.scheduleId ?? null,
          classDate: body.classDate,
          status: body.status,
          unitsScheduled: scheduled,
          unitsMissed: missedFor(body.status, scheduled, body.unitsMissed),
          isExcused: absence && body.isExcused,
          reason: absence ? (body.reason ?? null) : null,
          note: body.note ?? null,
          content: body.content ?? null,
        })
        .returning()) as [AttendanceRow];
    } catch (error) {
      if (isUniqueViolation(error, "attendance_logs_one_per_occurrence")) throw this.conflict();
      throw error;
    }

    return { record: toRecord(row), summary: await this.summarizeAndAlert(tx, subject) };
  }

  private conflict(existingId?: string) {
    return new ConflictException({
      code: AttendanceErrorCode.conflict,
      detail: existingId
        ? `Esta aula já tem registro (${existingId}). Edite o registro em vez de criar outro.`
        : "Esta aula já tem registro. Edite o registro em vez de criar outro.",
    });
  }

  update(
    id: string,
    expectedVersion: number,
    body: UpdateAttendanceBody,
  ): Promise<AttendanceResult> {
    return this.db.tx(async (tx) => {
      const [current] = await tx.select().from(attendanceLogs).where(eq(attendanceLogs.id, id));
      if (!current) throw attendanceNotFound();

      const status = body.status ?? current.status;
      const absence = countsAsAbsence(status);
      const isExcused = body.isExcused ?? (absence ? current.isExcused : false);
      if (isExcused && !absence)
        throw fieldError("isExcused", "Só falta (total ou parcial) pode ser abonada.");

      const partialMissed =
        body.unitsMissed ?? (current.status === "partial" ? current.unitsMissed : undefined);
      if (status === "partial") {
        if (partialMissed === undefined)
          throw fieldError("unitsMissed", "Informe quantas aulas você perdeu.");
        if (partialMissed >= current.unitsScheduled) {
          throw fieldError(
            "unitsMissed",
            current.unitsScheduled === 1
              ? "Com 1 aula só no dia, não há falta parcial: marque falta total."
              : `Num dia de ${current.unitsScheduled} aulas, a falta parcial vai de 1 a ${current.unitsScheduled - 1}.`,
          );
        }
      }

      const rows = await tx
        .update(attendanceLogs)
        .set({
          status,
          unitsMissed: missedFor(status, current.unitsScheduled, partialMissed),
          isExcused: absence && isExcused,
          reason: absence ? (body.reason !== undefined ? body.reason : current.reason) : null,
          note: body.note !== undefined ? body.note : current.note,
          content: body.content !== undefined ? body.content : current.content,
        })
        .where(and(eq(attendanceLogs.id, id), eq(attendanceLogs.version, expectedVersion)))
        .returning();
      const row = await assertVersioned(rows, async () => true, "Registro não encontrado.");

      const [subject] = await tx.select().from(subjects).where(eq(subjects.id, row.subjectId));
      return { record: toRecord(row), summary: await this.summarizeAndAlert(tx, subject!) };
    });
  }

  remove(id: string, expectedVersion: number): Promise<AttendanceDeleted> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .delete(attendanceLogs)
        .where(and(eq(attendanceLogs.id, id), eq(attendanceLogs.version, expectedVersion)))
        .returning();
      const row = await assertVersioned(
        rows,
        async () => {
          const [exists] = await tx
            .select({ id: attendanceLogs.id })
            .from(attendanceLogs)
            .where(eq(attendanceLogs.id, id));
          return exists !== undefined;
        },
        "Registro não encontrado.",
      );
      const [subject] = await tx.select().from(subjects).where(eq(subjects.id, row.subjectId));
      return { summary: await this.summarizeAndAlert(tx, subject!) };
    });
  }

  list(subjectId: string, query: AttendanceListQuery): Promise<AttendanceList> {
    return this.db.tx(async (tx) => {
      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.id, subjectId));
      if (!subject) throw new NotFoundException({ detail: "Matéria não encontrada." });

      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      if (query.cursor && !cursor)
        throw fieldError("cursor", "Cursor inválido. Recomece a listagem.");

      const filters = [eq(attendanceLogs.subjectId, subjectId)];
      if (query.status) filters.push(eq(attendanceLogs.status, query.status));
      if (cursor) {
        filters.push(
          sql`(${attendanceLogs.classDate}, ${attendanceLogs.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
        );
      }

      const rows = await tx
        .select()
        .from(attendanceLogs)
        .where(and(...filters))
        .orderBy(desc(attendanceLogs.classDate), desc(attendanceLogs.id))
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        records: page.map(toRecord),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.classDate, last.id) : null,
      };
    });
  }

  private async todayFor(tx: Tx): Promise<string> {
    const [me] = await tx.select({ timezone: users.timezone }).from(users);
    return this.clock.todayIn(me?.timezone ?? "America/Sao_Paulo");
  }
}

const CURSOR =
  /^(\d{4}-\d{2}-\d{2})\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { date: string; id: string } | undefined {
  const match = CURSOR.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match ? { date: match[1]!, id: match[2]! } : undefined;
}
