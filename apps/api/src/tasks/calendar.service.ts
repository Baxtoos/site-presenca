import { Injectable } from "@nestjs/common";
import type {
  CalendarDay,
  CalendarDayException,
  CalendarQuery,
  CalendarResponse,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { addDays, classOccurrences, zonedTimeToUtc } from "@presenca/engine";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { ClockService } from "../common/clock";
import { DbService } from "../database/db.service";
import { TasksService } from "./tasks.service";

const { semesters, subjects, subjectSchedules, calendarExceptions, attendanceLogs } = schema;

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/**
 * Linha do tempo e calendário mensal: as tarefas agrupadas pelo dia local do aluno (um prazo às
 * 23:59 de domingo fica no domingo, mesmo sendo segunda em UTC), as exceções dos semestres ativos e,
 * nos dias que já passaram, quantas aulas da grade ficaram sem chamada.
 */
@Injectable()
export class TaskCalendarService {
  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
    private readonly tasks: TasksService,
  ) {}

  get(query: CalendarQuery): Promise<CalendarResponse> {
    return this.db.tx(async (tx) => {
      const tz = await this.tasks.timezoneOf(tx);
      const today = this.clock.todayIn(tz);
      const days = new Map<string, CalendarDay>();
      const dayOf = (date: string): CalendarDay => {
        let day = days.get(date);
        if (!day) {
          day = { date, tasks: [], exceptions: [], pendingClasses: 0 };
          days.set(date, day);
        }
        return day;
      };

      const [tasks, overdueCount] = [
        await this.tasks.inRangeTx(tx, tz, {
          from: zonedTimeToUtc(query.from, "00:00", tz),
          to: zonedTimeToUtc(addDays(query.to, 1), "00:00", tz),
          subjectId: query.subjectId,
          status: query.status,
        }),
        await this.tasks.overdueCountTx(tx, query.subjectId),
      ];
      for (const task of tasks) dayOf(task.dueLocal.date).tasks.push(task);

      await this.addSemesterDays(tx, query, today, dayOf);

      return {
        from: query.from,
        to: query.to,
        today,
        timezone: tz,
        overdueCount,
        days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
  }

  /** Exceções do calendário e chamadas pendentes dos semestres ativos que tocam o intervalo. */
  private async addSemesterDays(
    tx: Tx,
    query: CalendarQuery,
    today: string,
    dayOf: (date: string) => CalendarDay,
  ) {
    const active = await tx
      .select({
        id: semesters.id,
        label: semesters.label,
        startsOn: semesters.startsOn,
        endsOn: semesters.endsOn,
      })
      .from(semesters)
      .where(
        and(
          eq(semesters.status, "active"),
          lte(semesters.startsOn, query.to),
          gte(semesters.endsOn, query.from),
        ),
      );
    if (active.length === 0) return;
    const semesterIds = active.map((s) => s.id);
    const bySemester = new Map(active.map((s) => [s.id, s]));

    const subjectRows = await tx
      .select({ id: subjects.id, name: subjects.name, semesterId: subjects.semesterId })
      .from(subjects)
      .where(
        and(
          inArray(subjects.semesterId, semesterIds),
          isNull(subjects.archivedAt),
          query.subjectId ? eq(subjects.id, query.subjectId) : undefined,
        ),
      );
    const subjectName = new Map(subjectRows.map((s) => [s.id, s.name]));

    const exceptions = await tx
      .select()
      .from(calendarExceptions)
      .where(
        and(
          inArray(calendarExceptions.semesterId, semesterIds),
          lte(calendarExceptions.startsOn, query.to),
          gte(calendarExceptions.endsOn, query.from),
          query.subjectId
            ? or(
                isNull(calendarExceptions.subjectId),
                eq(calendarExceptions.subjectId, query.subjectId),
              )
            : undefined,
        ),
      );
    for (const e of exceptions) {
      const semester = bySemester.get(e.semesterId)!;
      const info: CalendarDayException = {
        kind: e.kind,
        label: e.label,
        semesterLabel: semester.label,
        subjectName: e.subjectId ? (subjectName.get(e.subjectId) ?? null) : null,
      };
      // Exceção de matéria arquivada (ou fora do filtro) não aparece.
      if (e.subjectId && !subjectName.has(e.subjectId)) continue;
      const last = minDate(e.endsOn, query.to);
      for (let date = maxDate(e.startsOn, query.from); date <= last; date = addDays(date, 1)) {
        dayOf(date).exceptions.push(info);
      }
    }

    // Chamadas pendentes: só dias que já passaram (hoje fica para a tela Hoje).
    const pastTo = minDate(query.to, addDays(today, -1));
    if (query.from > pastTo || subjectRows.length === 0) return;
    const subjectIds = subjectRows.map((s) => s.id);
    const [schedules, logs] = [
      await tx
        .select({
          id: subjectSchedules.id,
          subjectId: subjectSchedules.subjectId,
          weekday: subjectSchedules.weekday,
          units: subjectSchedules.units,
          validFrom: subjectSchedules.validFrom,
          validUntil: subjectSchedules.validUntil,
        })
        .from(subjectSchedules)
        .where(inArray(subjectSchedules.subjectId, subjectIds)),
      await tx
        .select({
          subjectId: attendanceLogs.subjectId,
          classDate: attendanceLogs.classDate,
          scheduleId: attendanceLogs.scheduleId,
        })
        .from(attendanceLogs)
        .where(
          and(
            inArray(attendanceLogs.subjectId, subjectIds),
            gte(attendanceLogs.classDate, query.from),
            lte(attendanceLogs.classDate, pastTo),
          ),
        ),
    ];
    const registered = new Set(logs.map((l) => `${l.subjectId}|${l.classDate}|${l.scheduleId}`));
    for (const subject of subjectRows) {
      const semester = bySemester.get(subject.semesterId)!;
      const from = maxDate(query.from, semester.startsOn);
      const to = minDate(pastTo, semester.endsOn);
      if (from > to) continue;
      const occurrences = classOccurrences({
        schedules: schedules.filter((s) => s.subjectId === subject.id),
        exceptions: exceptions.filter(
          (e) =>
            e.semesterId === semester.id && (e.subjectId === null || e.subjectId === subject.id),
        ),
        from,
        to,
      });
      for (const o of occurrences) {
        if (!registered.has(`${subject.id}|${o.date}|${o.scheduleId}`)) {
          dayOf(o.date).pendingClasses += 1;
        }
      }
    }
  }
}
