import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { AttendanceErrorCode, type TodayClass, type TodayResponse } from "@presenca/contracts";
import { schema } from "@presenca/db";
import { isoWeekday, summarize } from "@presenca/engine";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { NO_ATTENDANCE, rulesFromRow } from "../academic/mappers";
import { ClockService } from "../common/clock";
import { DbService } from "../database/db.service";
import { toRecord } from "./attendance.mapper";
import { inOrder } from "../common/in-order";

const {
  semesters,
  subjects,
  subjectSchedules,
  calendarExceptions,
  attendanceLogs,
  subjectTotals,
  users,
} = schema;

const hhmm = (time: string) => time.slice(0, 5);

@Injectable()
export class TodayService {
  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
  ) {}

  /**
   * As aulas de um dia (hoje, por padrão) de todos os semestres ativos que contêm esse dia,
   * com o registro já feito e o resumo atual de cada matéria.
   */
  get(requestedDate?: string): Promise<TodayResponse> {
    return this.db.tx(async (tx) => {
      const [me] = await tx.select({ timezone: users.timezone }).from(users);
      const today = this.clock.todayIn(me?.timezone ?? "America/Sao_Paulo");
      const date = requestedDate ?? today;
      if (date > today) {
        throw new UnprocessableEntityException({
          code: AttendanceErrorCode.futureDate,
          errors: [{ path: "date", message: "Só dá para ver e registrar aulas até hoje." }],
        });
      }
      const weekday = isoWeekday(date);

      const activeSemesters = await tx
        .select({ id: semesters.id })
        .from(semesters)
        .where(
          and(
            eq(semesters.status, "active"),
            lte(semesters.startsOn, date),
            gte(semesters.endsOn, date),
          ),
        );
      const base = { date, weekday, isToday: date === today };
      if (activeSemesters.length === 0) return { ...base, classes: [], exceptions: [] };
      const semesterIds = activeSemesters.map((s) => s.id);

      const subjectRows = await tx
        .select()
        .from(subjects)
        .where(and(inArray(subjects.semesterId, semesterIds), isNull(subjects.archivedAt)));
      if (subjectRows.length === 0) return { ...base, classes: [], exceptions: [] };
      const subjectIds = subjectRows.map((s) => s.id);

      const [schedules, exceptions, logs, totals] = await inOrder([
        tx
          .select()
          .from(subjectSchedules)
          .where(
            and(
              inArray(subjectSchedules.subjectId, subjectIds),
              eq(subjectSchedules.weekday, weekday),
              or(isNull(subjectSchedules.validFrom), lte(subjectSchedules.validFrom, date)),
              or(isNull(subjectSchedules.validUntil), gte(subjectSchedules.validUntil, date)),
            ),
          )
          .orderBy(asc(subjectSchedules.startsAt)),
        tx
          .select()
          .from(calendarExceptions)
          .where(
            and(
              inArray(calendarExceptions.semesterId, semesterIds),
              lte(calendarExceptions.startsOn, date),
              gte(calendarExceptions.endsOn, date),
            ),
          ),
        tx
          .select()
          .from(attendanceLogs)
          .where(
            and(inArray(attendanceLogs.subjectId, subjectIds), eq(attendanceLogs.classDate, date)),
          ),
        tx.select().from(subjectTotals).where(inArray(subjectTotals.subjectId, subjectIds)),
      ]);

      const totalsById = new Map(
        totals.map((t) => [
          t.subjectId,
          { unitsCounted: t.unitsCounted, unitsExcused: t.unitsExcused, unitsHeld: t.unitsHeld },
        ]),
      );
      const summaryOf = (row: (typeof subjectRows)[number]) =>
        summarize(rulesFromRow(row), totalsById.get(row.id) ?? NO_ATTENDANCE);

      /** Feriado ou dia sem aula que cancela a aula desta matéria (global ou só dela). */
      const blockedFor = (subject: (typeof subjectRows)[number]) => {
        const hit = exceptions.find(
          (e) =>
            e.kind !== "exam_week" &&
            e.semesterId === subject.semesterId &&
            (e.subjectId === null || e.subjectId === subject.id),
        );
        return hit && hit.kind !== "exam_week" ? { kind: hit.kind, label: hit.label } : null;
      };

      const classes: TodayClass[] = [];
      const used = new Set<string>();
      for (const schedule of schedules) {
        const subject = subjectRows.find((s) => s.id === schedule.subjectId)!;
        const log = logs.find((l) => l.scheduleId === schedule.id);
        if (log) used.add(log.id);
        classes.push({
          subject: toSubjectInfo(subject),
          scheduleId: schedule.id,
          startsAt: hhmm(schedule.startsAt),
          endsAt: hhmm(schedule.endsAt),
          units: schedule.units,
          room: schedule.room,
          blocked: blockedFor(subject),
          record: log ? toRecord(log) : null,
          summary: summaryOf(subject),
        });
      }
      // Aulas extras ou de horários que já saíram da grade: aparecem para poderem ser corrigidas.
      for (const log of logs.filter((l) => !used.has(l.id))) {
        const subject = subjectRows.find((s) => s.id === log.subjectId)!;
        classes.push({
          subject: toSubjectInfo(subject),
          scheduleId: null,
          startsAt: null,
          endsAt: null,
          units: log.unitsScheduled,
          room: null,
          blocked: null,
          record: toRecord(log),
          summary: summaryOf(subject),
        });
      }

      classes.sort(
        (a, b) =>
          (a.startsAt ?? "99:99").localeCompare(b.startsAt ?? "99:99") ||
          a.subject.name.localeCompare(b.subject.name),
      );
      return {
        ...base,
        classes,
        exceptions: exceptions.map((e) => ({ kind: e.kind, label: e.label })),
      };
    });
  }
}

function toSubjectInfo(row: typeof subjects.$inferSelect): TodayClass["subject"] {
  return {
    id: row.id,
    name: row.name,
    color: (row.color as TodayClass["subject"]["color"]) ?? null,
    professor: row.professor,
    unitsPerClass: row.unitsPerClass,
  };
}
