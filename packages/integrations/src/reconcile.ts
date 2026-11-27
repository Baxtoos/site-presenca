import { schema, type Tx } from "@presenca/db";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { normalizeTitle, type MoodleDeadline } from "./moodle";

const { tasks, moodleCourseMappings, notificationLogs, subjects, semesters } = schema;

export interface ReconcileResult {
  created: number;
  updated: number;
  completed: number;
  courses: number;
}

const DEFAULT_REMIND = 1440;

export async function reconcileDeadlines(
  tx: Tx,
  input: { userId: string; deadlines: readonly MoodleDeadline[]; now: Date },
): Promise<ReconcileResult> {
  const { userId, now } = input;
  const result: ReconcileResult = { created: 0, updated: 0, completed: 0, courses: 0 };

  const courseKeys = [
    ...new Set(input.deadlines.map((d) => d.courseKey).filter((k): k is string => !!k)),
  ];
  result.courses = courseKeys.length;
  if (courseKeys.length > 0) {
    const coded = await tx
      .select({ id: subjects.id, code: subjects.code })
      .from(subjects)
      .innerJoin(semesters, eq(semesters.id, subjects.semesterId))
      .where(
        and(
          eq(subjects.userId, userId),
          isNotNull(subjects.code),
          isNull(subjects.archivedAt),
          eq(semesters.status, "active"),
        ),
      );
    for (const courseKey of courseKeys) {
      const key = normalizeTitle(courseKey);
      const guess = coded.find((s) => s.code && key.includes(normalizeTitle(s.code)));
      await tx.execute(sql`
        insert into app.moodle_course_mappings (user_id, course_key, subject_id, last_seen_at)
        values (${userId}, ${courseKey}, ${guess?.id ?? null}, ${now})
        on conflict (user_id, course_key) do update set last_seen_at = ${now}`);
    }
  }
  const mappings = new Map(
    (
      await tx
        .select({
          courseKey: moodleCourseMappings.courseKey,
          subjectId: moodleCourseMappings.subjectId,
          ignored: moodleCourseMappings.ignored,
        })
        .from(moodleCourseMappings)
        .where(eq(moodleCourseMappings.userId, userId))
    ).map((m) => [m.courseKey, m]),
  );

  const uids = input.deadlines.map((d) => d.externalUid);
  const existing =
    uids.length === 0
      ? []
      : await tx
          .select({
            id: tasks.id,
            source: tasks.source,
            externalUid: tasks.externalUid,
            title: tasks.title,
            dueAt: tasks.dueAt,
            externalUrl: tasks.externalUrl,
            subjectId: tasks.subjectId,
            status: tasks.status,
            statusSource: tasks.statusSource,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.userId, userId),
              inArray(tasks.source, ["moodle_ics", "moodle_api"]),
              inArray(tasks.externalUid, uids),
            ),
          );
  const byUid = new Map(existing.map((t) => [`${t.source}|${t.externalUid}`, t]));

  for (const d of input.deadlines) {
    const mapping = d.courseKey ? mappings.get(d.courseKey) : undefined;
    if (mapping?.ignored) continue;
    const subjectId = mapping?.subjectId ?? null;
    const current = byUid.get(`${d.source}|${d.externalUid}`);

    if (!current) {
      if (d.dueAt.getTime() <= now.getTime()) continue;
      await tx.execute(sql`
        insert into app.tasks (user_id, subject_id, title, due_at, remind_before_minutes, status,
                               status_source, resolved_at, source, external_uid, external_url,
                               external_course_key)
        values (${userId}, ${subjectId}, ${d.title}, ${d.dueAt}, ${DEFAULT_REMIND},
                ${d.submitted ? "completed" : "pending"}, 'sync', ${d.submitted ? now : null},
                ${d.source}, ${d.externalUid}, ${d.url}, ${d.courseKey})
        on conflict (user_id, source, external_uid) where external_uid is not null do nothing`);
      result.created++;
      continue;
    }

    const patch: Partial<typeof tasks.$inferInsert> = {};
    const dueChanged = current.dueAt.getTime() !== d.dueAt.getTime();
    if (current.title !== d.title) patch.title = d.title;
    if (dueChanged) patch.dueAt = d.dueAt;
    if (d.url && current.externalUrl !== d.url) patch.externalUrl = d.url;
    if (!current.subjectId && subjectId) patch.subjectId = subjectId;
    const autoComplete =
      d.submitted && current.status === "pending" && current.statusSource !== "user";
    if (autoComplete) {
      patch.status = "completed";
      patch.statusSource = "sync";
      patch.resolvedAt = now;
    }
    if (Object.keys(patch).length === 0) continue;

    await tx.update(tasks).set(patch).where(eq(tasks.id, current.id));
    if (dueChanged || autoComplete) {
      await tx
        .update(notificationLogs)
        .set({
          status: "skipped",
          lastError: autoComplete ? "entregue no Moodle" : "prazo alterado no Moodle",
        })
        .where(
          and(
            eq(notificationLogs.taskId, current.id),
            inArray(notificationLogs.channel, ["push", "email"]),
            inArray(notificationLogs.status, ["pending", "failed"]),
          ),
        );
    }
    if (autoComplete) result.completed++;
    else result.updated++;
  }
  return result;
}

export async function detachImportedTasks(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .update(tasks)
    .set({ source: "manual", externalUid: null, externalCourseKey: null })
    .where(and(eq(tasks.userId, userId), sql`${tasks.source} <> 'manual'`))
    .returning({ id: tasks.id });
  return rows.length;
}
