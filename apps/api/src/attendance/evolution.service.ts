import { Injectable, NotFoundException } from "@nestjs/common";
import { saveGradingBodySchema, type SubjectEvolution } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { type EvaluationItem, localParts, summarize, summarizeGrades } from "@presenca/engine";
import { asc, eq, sql } from "drizzle-orm";
import { rulesFromRow } from "../academic/mappers";
import { loadTotals } from "../academic/summary";
import { ClockService } from "../common/clock";
import { DbService } from "../database/db.service";

const { subjects, semesters, users, attendanceLogs, gradingSchemes, evaluationItems } = schema;

@Injectable()
export class EvolutionService {
  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
  ) {}

  get(subjectId: string): Promise<SubjectEvolution> {
    return this.db.tx(async (tx) => {
      const [found] = await tx
        .select({ subject: subjects, semester: semesters })
        .from(subjects)
        .innerJoin(semesters, eq(semesters.id, subjects.semesterId))
        .where(eq(subjects.id, subjectId));
      if (!found) throw new NotFoundException({ detail: "Matéria não encontrada." });
      const { subject, semester } = found;
      const [me] = await tx.select({ timezone: users.timezone }).from(users);
      const tz = me?.timezone ?? "America/Sao_Paulo";
      const limit = summarize(
        rulesFromRow(subject),
        await loadTotals(tx, subject.id),
      ).maxAbsenceUnits;

      const daily = await tx
        .select({
          date: attendanceLogs.classDate,
          units: sql<number>`coalesce(sum(${attendanceLogs.unitsMissed}) filter (
            where ${attendanceLogs.status} in ('absent', 'partial')
              and (not ${attendanceLogs.isExcused} or ${subject.excusedPolicy} = 'track_only')
          ), 0)::int`,
        })
        .from(attendanceLogs)
        .where(eq(attendanceLogs.subjectId, subject.id))
        .groupBy(attendanceLogs.classDate)
        .orderBy(asc(attendanceLogs.classDate));
      let total = 0;
      const absences = daily
        .filter((d) => d.units > 0)
        .map((d) => ({ date: d.date, total: (total += d.units) }));

      return {
        semester: { startsOn: semester.startsOn, endsOn: semester.endsOn },
        today: this.clock.todayIn(tz),
        absences: { limit, points: absences },
        grades: await this.gradePoints(tx, subject.id, tz),
      };
    });
  }

  private async gradePoints(
    tx: Tx,
    subjectId: string,
    tz: string,
  ): Promise<SubjectEvolution["grades"]> {
    const [scheme] = await tx
      .select({ rules: gradingSchemes.rules })
      .from(gradingSchemes)
      .where(eq(gradingSchemes.subjectId, subjectId));
    const rules = scheme ? saveGradingBodySchema.shape.rules.safeParse(scheme.rules) : null;
    if (!rules?.success) return null;
    const rows = await tx
      .select()
      .from(evaluationItems)
      .where(eq(evaluationItems.subjectId, subjectId));
    const scoredOn = new Map(
      rows.map((r) => [r.id, r.scoredAt ? localParts(r.scoredAt, tz).date : null]),
    );
    const dates = [
      ...new Set([...scoredOn.values()].filter((d): d is string => d !== null)),
    ].sort();
    const points: NonNullable<SubjectEvolution["grades"]>["points"] = [];
    for (const date of dates) {
      const items: EvaluationItem[] = rows.map((r) => {
        const on = scoredOn.get(r.id);
        return {
          key: r.key,
          name: r.name,
          maxScore: r.maxScore,
          group: r.groupKey,
          role: r.role as EvaluationItem["role"],
          score: on !== null && on !== undefined && on <= date ? r.score : null,
        };
      });
      try {
        const s = summarizeGrades(rules.data, items);
        points.push({ date, guaranteed: s.final ?? s.guaranteed, partial: s.partial });
      } catch {
        return null;
      }
    }
    return { scale: rules.data.scale, passing: rules.data.passing, points };
  }
}
