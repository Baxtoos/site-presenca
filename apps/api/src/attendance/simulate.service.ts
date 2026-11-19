import { Injectable, NotFoundException } from "@nestjs/common";
import type { SimulateResponse } from "@presenca/contracts";
import { schema } from "@presenca/db";
import {
  addDays,
  classOccurrences,
  planSkips,
  presencePct,
  riskLevel,
  summarize,
} from "@presenca/engine";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { loadTotals } from "../academic/summary";
import { rulesFromRow } from "../academic/mappers";
import { ClockService } from "../common/clock";
import { DbService } from "../database/db.service";
import { inOrder } from "../common/in-order";

const { subjects, semesters, subjectSchedules, calendarExceptions, attendanceLogs, users } = schema;

/** Limite do motor por chamada (classOccurrences recusa intervalos maiores que 400 dias). */
const MAX_DAYS = 399;

@Injectable()
export class SimulateService {
  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
  ) {}

  /**
   * "Posso faltar?": o que acontece se faltar à próxima aula e quantas aulas seguidas dá para
   * faltar sem passar do limite, contando só as aulas que ainda vão acontecer (a grade real,
   * sem feriados e sem as aulas que já têm registro).
   */
  get(subjectId: string): Promise<SimulateResponse> {
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

      const rules = rulesFromRow(subject);
      const summary = summarize(rules, await loadTotals(tx, subject.id));

      // Aulas futuras: de hoje (se ainda sem registro) até o fim do semestre.
      const from = today < semester.startsOn ? semester.startsOn : today;
      const lastDay =
        semester.endsOn < addDays(from, MAX_DAYS) ? semester.endsOn : addDays(from, MAX_DAYS);

      let upcoming: ReturnType<typeof classOccurrences> = [];
      if (from <= lastDay) {
        const [schedules, exceptions, registered] = await inOrder([
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
              ),
            ),
          tx
            .select({ classDate: attendanceLogs.classDate, scheduleId: attendanceLogs.scheduleId })
            .from(attendanceLogs)
            .where(
              and(eq(attendanceLogs.subjectId, subject.id), gte(attendanceLogs.classDate, from)),
            ),
        ]);
        const done = new Set(registered.map((r) => `${r.classDate}|${r.scheduleId ?? ""}`));
        upcoming = classOccurrences({
          schedules: schedules.map((s) => ({
            id: s.id,
            weekday: s.weekday,
            units: s.units,
            validFrom: s.validFrom,
            validUntil: s.validUntil,
          })),
          exceptions: exceptions.map((e) => ({
            startsOn: e.startsOn,
            endsOn: e.endsOn,
            kind: e.kind,
          })),
          from,
          to: lastDay,
        }).filter((o) => !done.has(`${o.date}|${o.scheduleId ?? ""}`));
      }

      const next = upcoming[0];
      let ifSkipNext: SimulateResponse["ifSkipNext"] = null;
      if (next) {
        const absent = summary.absentUnits + next.units;
        const remaining = summary.maxAbsenceUnits - absent;
        const total = summary.totalUnits;
        ifSkipNext = {
          absentUnits: absent,
          remainingUnits: remaining,
          remainingClasses: Math.floor(Math.max(0, remaining) / rules.unitsPerClass),
          risk: riskLevel(absent, summary.maxAbsenceUnits, rules.unitsPerClass),
          projectedPresencePct: total === null ? null : presencePct(total, Math.min(absent, total)),
          allowed: remaining >= 0,
        };
      }

      const plan = planSkips(summary.remainingUnits, upcoming);
      return {
        asOf: today,
        summary,
        nextClass: next
          ? { date: next.date, units: next.units, scheduleId: next.scheduleId ?? null }
          : null,
        ifSkipNext,
        plan: {
          classes: plan.classes,
          units: plan.units,
          untilDate: plan.untilDate,
          firstUnsafe: plan.firstUnsafe
            ? { date: plan.firstUnsafe.date, units: plan.firstUnsafe.units }
            : null,
        },
        upcomingClasses: upcoming.length,
      };
    });
  }
}
