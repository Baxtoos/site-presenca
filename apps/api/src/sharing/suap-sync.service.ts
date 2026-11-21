import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SUBJECT_COLORS, type SuapSyncBody, type SuapSyncResult } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { isoWeekday } from "@presenca/engine";
import { and, eq, inArray, sql } from "drizzle-orm";
import { freeSemesterLabel } from "../academic/labels";
import { scheduleColumns, subjectColumns } from "../academic/mappers";
import { loadSummary } from "../academic/summary";
import { ClockService } from "../common/clock";
import { type IdempotentResult, IdempotencyService } from "../common/idempotency";
import { DbService } from "../database/db.service";
import { ThresholdAlerts } from "../notifications/threshold-alerts";
import {
  attendanceFrom,
  lessonsByDate,
  mergeSlots,
  prettyName,
  roomFrom,
  rulesFor,
  semesterRange,
} from "./suap.mapper";

const { semesters, subjects, subjectSchedules, attendanceLogs, users } = schema;

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Sincroniza um semestre com o retrato do SUAP: cria o que falta (semestre, matérias com regras e
 * grade) e põe em dia os registros das aulas já lançadas. Nas aulas que o professor lançou, vale o
 * SUAP (é o registro oficial); o que o aluno marcou em dias que o SUAP ainda não tem fica como está.
 * Pode ser repetida quantas vezes quiser: só muda o que mudou.
 */
@Injectable()
export class SuapSyncService {
  private readonly logger = new Logger(SuapSyncService.name);

  constructor(
    private readonly db: DbService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: ClockService,
    private readonly thresholds: ThresholdAlerts,
  ) {}

  sync(userId: string, body: SuapSyncBody, key: string): Promise<IdempotentResult<SuapSyncResult>> {
    return this.db.tx((tx) =>
      this.idempotency.run(tx, key, body, async () => ({
        status: 200,
        body: await this.syncInTx(tx, userId, body),
      })),
    );
  }

  private async syncInTx(tx: Tx, userId: string, body: SuapSyncBody): Promise<SuapSyncResult> {
    const snap = body.snapshot;
    const [me] = await tx.select({ timezone: users.timezone }).from(users);
    const today = this.clock.todayIn(me?.timezone ?? "America/Sao_Paulo");

    const perSubject = snap.subjects.map((s) => ({ suap: s, lessons: lessonsByDate(s.lessons) }));
    const allDates = perSubject.flatMap((p) => p.lessons.map((l) => l.date));
    const pastDates = allDates.filter((d) => d <= today);
    const future = allDates.length - pastDates.length;

    // ---- semestre: o escolhido ou um novo
    let semester: { id: string; label: string; startsOn: string; endsOn: string };
    let createdSemester = false;
    if (body.semesterId) {
      const [row] = await tx
        .select({
          id: semesters.id,
          label: semesters.label,
          startsOn: semesters.startsOn,
          endsOn: semesters.endsOn,
        })
        .from(semesters)
        .where(eq(semesters.id, body.semesterId));
      if (!row) throw new NotFoundException({ detail: "Semestre não encontrado." });
      semester = row;
      // Aula lançada fora das datas do semestre: o semestre cresce para caber.
      const sorted = [...allDates].sort();
      const startsOn = sorted[0] && sorted[0] < row.startsOn ? sorted[0] : row.startsOn;
      const endsOn = sorted.at(-1) && sorted.at(-1)! > row.endsOn ? sorted.at(-1)! : row.endsOn;
      if (startsOn !== row.startsOn || endsOn !== row.endsOn) {
        await tx.update(semesters).set({ startsOn, endsOn }).where(eq(semesters.id, row.id));
        semester = { ...row, startsOn, endsOn };
      }
    } else {
      const range = semesterRange(snap.period, allDates);
      const label = await freeSemesterLabel(tx, body.label ?? range.label);
      const [hasCurrent] = await tx
        .select({ id: semesters.id })
        .from(semesters)
        .where(eq(semesters.isCurrent, true))
        .limit(1);
      const [row] = await tx
        .insert(semesters)
        .values({
          userId,
          label,
          startsOn: range.startsOn,
          endsOn: range.endsOn,
          isCurrent: !hasCurrent,
        })
        .returning({ id: semesters.id });
      semester = { id: row!.id, label, startsOn: range.startsOn, endsOn: range.endsOn };
      createdSemester = true;
    }

    // ---- matérias: acha pela sigla do SUAP (guardada no código) ou pelo nome; senão cria
    const existing = await tx
      .select({ id: subjects.id, name: subjects.name, code: subjects.code })
      .from(subjects)
      .where(eq(subjects.semesterId, semester.id));
    let subjectsCreated = 0;
    const linked: { subjectId: string; lessons: (typeof perSubject)[number]["lessons"] }[] = [];
    for (const { suap, lessons } of perSubject) {
      const code = suap.code.toLowerCase();
      const found =
        existing.find((s) => s.code?.toLowerCase() === code) ??
        existing.find((s) => normalize(s.name) === normalize(suap.name)) ??
        existing.find((s) => normalize(s.name) === normalize(prettyName(suap.name)));
      if (found) {
        linked.push({ subjectId: found.id, lessons });
        continue;
      }
      const schedules = mergeSlots(suap.slots);
      const room = roomFrom(suap.location);
      const rules = rulesFor(suap, schedules);
      const [row] = await tx
        .insert(subjects)
        .values({
          ...subjectColumns({
            name: prettyName(suap.name).slice(0, 120),
            code: suap.code.slice(0, 20),
            professor: suap.professor ? prettyName(suap.professor).slice(0, 120) : null,
            color: SUBJECT_COLORS[(existing.length + subjectsCreated) % SUBJECT_COLORS.length],
            excusedPolicy: "deduct",
            ...rules,
          }),
          userId: sql`app.current_user_id()`,
          semesterId: semester.id,
        })
        .returning({ id: subjects.id, name: subjects.name, code: subjects.code });
      if (schedules.length > 0) {
        await tx.insert(subjectSchedules).values(
          schedules.map((s) => ({
            ...scheduleColumns({ ...s, room }),
            userId: sql`app.current_user_id()`,
            subjectId: row!.id,
          })),
        );
      }
      existing.push(row!);
      subjectsCreated++;
      linked.push({ subjectId: row!.id, lessons });
    }

    // ---- registros das aulas já lançadas
    const ids = linked.map((l) => l.subjectId);
    const schedules =
      ids.length > 0
        ? await tx
            .select({
              id: subjectSchedules.id,
              subjectId: subjectSchedules.subjectId,
              weekday: subjectSchedules.weekday,
              startsAt: subjectSchedules.startsAt,
            })
            .from(subjectSchedules)
            .where(inArray(subjectSchedules.subjectId, ids))
        : [];
    const logs =
      ids.length > 0
        ? await tx.select().from(attendanceLogs).where(inArray(attendanceLogs.subjectId, ids))
        : [];
    const logByKey = new Map(
      logs.map((l) => [`${l.subjectId}|${l.classDate}|${l.scheduleId ?? "extra"}`, l]),
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const touched = new Set<string>();
    const inserts: (typeof attendanceLogs.$inferInsert)[] = [];
    for (const { subjectId, lessons } of linked) {
      for (const lesson of lessons) {
        if (
          lesson.date > today ||
          lesson.date < semester.startsOn ||
          lesson.date > semester.endsOn
        ) {
          continue;
        }
        const weekday = isoWeekday(lesson.date);
        const slot = schedules
          .filter((s) => s.subjectId === subjectId && s.weekday === weekday)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
        const scheduleId = slot?.id ?? null;
        const want = attendanceFrom(lesson);
        const current = logByKey.get(`${subjectId}|${lesson.date}|${scheduleId ?? "extra"}`);
        if (current) {
          const same =
            current.status === want.status &&
            current.unitsScheduled === want.unitsScheduled &&
            current.unitsMissed === want.unitsMissed &&
            current.isExcused === want.isExcused;
          if (same) {
            unchanged++;
            continue;
          }
          await tx
            .update(attendanceLogs)
            .set({
              ...want,
              reason: want.status === "present" ? null : current.reason,
            })
            .where(and(eq(attendanceLogs.id, current.id)));
          updated++;
        } else {
          inserts.push({
            userId: sql`app.current_user_id()` as unknown as string,
            subjectId,
            scheduleId,
            classDate: lesson.date,
            ...want,
            reason: null,
            note:
              want.status !== "present" && lesson.content
                ? `Conteúdo da aula: ${lesson.content}`.slice(0, 500)
                : null,
          });
          created++;
        }
        touched.add(subjectId);
      }
    }
    for (let i = 0; i < inserts.length; i += 500) {
      await tx.insert(attendanceLogs).values(inserts.slice(i, i + 500));
    }

    // ---- marcos de aviso: semestre novo fica em dia em silêncio; atualização avisa o que mudou
    for (const subjectId of touched) {
      const [row] = await tx.select().from(subjects).where(eq(subjects.id, subjectId));
      const summary = await loadSummary(tx, row!);
      if (createdSemester) await this.thresholds.sync(tx, row!, summary);
      else await this.thresholds.evaluate(tx, row!, summary);
    }

    this.logger.log(
      `suap: semestre ${semester.id} (${createdSemester ? "novo" : "atualizado"}), ${subjectsCreated} matérias novas, ${created} criados, ${updated} corrigidos, ${unchanged} iguais`,
    );
    return {
      semesterId: semester.id,
      label: semester.label,
      createdSemester,
      subjectsCreated,
      created,
      updated,
      unchanged,
      future,
    };
  }
}
