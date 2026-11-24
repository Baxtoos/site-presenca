import { Injectable, NotFoundException } from "@nestjs/common";
import type { CalendarClass, SubjectCalendar } from "@presenca/contracts";
import { schema } from "@presenca/db";
import { addDays, isoWeekday, monthRange, shiftMonth, summarize } from "@presenca/engine";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { rulesFromRow } from "../academic/mappers";
import { loadTotals } from "../academic/summary";
import { ClockService } from "../common/clock";
import { inOrder } from "../common/in-order";
import { DbService } from "../database/db.service";
import { toRecord } from "./attendance.mapper";

const { subjects, semesters, subjectSchedules, calendarExceptions, attendanceLogs, users } = schema;

const hhmm = (time: string) => time.slice(0, 5);
const monthOf = (date: string) => date.slice(0, 7);

@Injectable()
export class CalendarService {
  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
  ) {}

  /**
   * O mês de uma matéria para marcar presença no calendário: cada dia de aula da grade (já com
   * feriados e dias sem aula indicados), o registro feito e as aulas extras registradas.
   */
  get(subjectId: string, requestedMonth?: string): Promise<SubjectCalendar> {
    return this.db.tx(async (tx) => {
      const [found] = await tx
        .select({ subject: subjects, semester: semesters })
        .from(subjects)
        .innerJoin(semesters, eq(semesters.id, subjects.semesterId))
        .where(eq(subjects.id, subjectId));
      if (!found) throw new NotFoundException({ detail: "Matéria não encontrada." });
      const { subject, semester } = found;

      const [me] = await tx.select({ timezone: users.timezone }).from(users);
      const today = this.clock.todayIn(me?.timezone ?? "America/Sao_Paulo");

      // Padrão: o mês de hoje, ou o mês do semestre mais próximo de hoje.
      const clampedToday =
        today < semester.startsOn
          ? semester.startsOn
          : today > semester.endsOn
            ? semester.endsOn
            : today;
      const month = requestedMonth ?? monthOf(clampedToday);
      const { first, last } = monthRange(month);
      const from = first < semester.startsOn ? semester.startsOn : first;
      const to = last > semester.endsOn ? semester.endsOn : last;

      const prev = shiftMonth(month, -1);
      const next = shiftMonth(month, 1);
      const base = {
        month,
        today,
        semester: { startsOn: semester.startsOn, endsOn: semester.endsOn },
        prevMonth: monthRange(prev).last >= semester.startsOn ? prev : null,
        nextMonth: monthRange(next).first <= semester.endsOn ? next : null,
        summary: summarize(rulesFromRow(subject), await loadTotals(tx, subject.id)),
      };
      if (from > to) return { ...base, days: [] };

      const [schedules, exceptions, logs] = await inOrder([
        tx.select().from(subjectSchedules).where(eq(subjectSchedules.subjectId, subject.id)),
        tx
          .select()
          .from(calendarExceptions)
          .where(
            and(
              eq(calendarExceptions.semesterId, semester.id),
              or(
                isNull(calendarExceptions.subjectId),
                eq(calendarExceptions.subjectId, subject.id),
              ),
              lte(calendarExceptions.startsOn, to),
              gte(calendarExceptions.endsOn, from),
            ),
          ),
        tx
          .select()
          .from(attendanceLogs)
          .where(
            and(
              eq(attendanceLogs.subjectId, subject.id),
              gte(attendanceLogs.classDate, from),
              lte(attendanceLogs.classDate, to),
            ),
          ),
      ]);

      const ordered = [...schedules].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const days: SubjectCalendar["days"] = [];
      const used = new Set<string>();

      for (let date = from; date <= to; date = addDays(date, 1)) {
        const weekday = isoWeekday(date);
        const block = exceptions.find(
          (e) => e.kind !== "exam_week" && e.startsOn <= date && date <= e.endsOn,
        );
        const classes: CalendarClass[] = [];
        for (const s of ordered) {
          if (s.weekday !== weekday) continue;
          if (s.validFrom && date < s.validFrom) continue;
          if (s.validUntil && date > s.validUntil) continue;
          const log = logs.find((l) => l.classDate === date && l.scheduleId === s.id);
          if (log) used.add(log.id);
          classes.push({
            scheduleId: s.id,
            startsAt: hhmm(s.startsAt),
            endsAt: hhmm(s.endsAt),
            units: s.units,
            room: s.room,
            blocked:
              block && block.kind !== "exam_week" ? { kind: block.kind, label: block.label } : null,
            record: log ? toRecord(log) : null,
          });
        }
        // Aulas extras ou de horários que saíram da grade: aparecem para poderem ser corrigidas.
        for (const log of logs.filter((l) => l.classDate === date && !used.has(l.id))) {
          used.add(log.id);
          classes.push({
            scheduleId: null,
            startsAt: null,
            endsAt: null,
            units: log.unitsScheduled,
            room: null,
            blocked: null,
            record: toRecord(log),
          });
        }
        if (classes.length > 0) days.push({ date, classes });
      }
      return { ...base, days };
    });
  }
}
