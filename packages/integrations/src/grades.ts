import { schema, type Tx } from "@presenca/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { type MoodleClient, type MoodleGradeItem, normalizeTitle } from "./moodle";

const { evaluationItems, subjects, moodleCourseMappings } = schema;

export const gradeItemKey = (id: number) => `gi:${id}`;

export function moodleScoreToCenti(grade: number, gradeMax: number, maxScore: number): number {
  const centi = Math.round((grade / gradeMax) * maxScore);
  return Math.min(maxScore, Math.max(0, centi));
}

export async function fetchCourseGrades(
  client: MoodleClient,
  courseKeys: readonly string[],
): Promise<Map<string, MoodleGradeItem[]>> {
  const out = new Map<string, MoodleGradeItem[]>();
  if (courseKeys.length === 0) return out;
  const wanted = new Map(courseKeys.map((k) => [normalizeTitle(k), k]));
  const site = await client.siteInfo();
  const courses = await client.courses(site.userId);
  for (const c of courses) {
    const key = wanted.get(normalizeTitle(c.shortname));
    if (!key || out.has(key)) continue;
    out.set(key, await client.gradeItems(c.id, site.userId));
  }
  return out;
}

export async function mappedCourses(tx: Tx, userId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      courseKey: moodleCourseMappings.courseKey,
      subjectId: moodleCourseMappings.subjectId,
    })
    .from(moodleCourseMappings)
    .where(
      and(
        eq(moodleCourseMappings.userId, userId),
        isNotNull(moodleCourseMappings.subjectId),
        eq(moodleCourseMappings.ignored, false),
        sql`exists (select 1 from app.evaluation_items e
                     where e.subject_id = ${moodleCourseMappings.subjectId}
                       and e.external_grade_item_id is not null
                       and e.score_source = 'moodle')`,
      ),
    );
  return new Map(rows.map((r) => [r.courseKey, r.subjectId!]));
}

export interface ApplyGradesResult {
  updated: number;
  posted: number;
}

/**
 * Aplica as notas do Moodle nas avaliações ligadas a um item (external_grade_item_id) que seguem o
 * Moodle (score_source = 'moodle'). Nota lançada pelo aluno (score_source = 'user') nunca é
 * sobrescrita. Nota nova gera o aviso "Nota nova" (no app, push e e-mail conforme as preferências),
 * uma vez só por item e nota (dedupe).
 *
 * Roda na transação de quem chama: na API como o aluno e no worker com as permissões mínimas do
 * app_worker (por isso o UPDATE e o INSERT são em SQL, só com as colunas permitidas).
 */
export async function applyMoodleGrades(
  tx: Tx,
  input: {
    userId: string;
    grades: Map<string, MoodleGradeItem[]>;
    courses: Map<string, string>;
    notify?: boolean;
  },
): Promise<ApplyGradesResult> {
  const result: ApplyGradesResult = { updated: 0, posted: 0 };
  const byKey = new Map<string, { item: MoodleGradeItem; subjectId: string }>();
  for (const [courseKey, items] of input.grades) {
    const subjectId = input.courses.get(courseKey);
    if (!subjectId) continue;
    for (const item of items) byKey.set(gradeItemKey(item.id), { item, subjectId });
  }
  if (byKey.size === 0) return result;

  const linked = await tx
    .select({
      id: evaluationItems.id,
      subjectId: evaluationItems.subjectId,
      name: evaluationItems.name,
      maxScore: evaluationItems.maxScore,
      score: evaluationItems.score,
      externalGradeItemId: evaluationItems.externalGradeItemId,
    })
    .from(evaluationItems)
    .where(
      and(
        eq(evaluationItems.userId, input.userId),
        eq(evaluationItems.scoreSource, "moodle"),
        inArray(evaluationItems.externalGradeItemId, [...byKey.keys()]),
      ),
    );
  if (linked.length === 0) return result;

  const names = new Map(
    (
      await tx
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(
          inArray(
            subjects.id,
            linked.map((l) => l.subjectId),
          ),
        )
    ).map((s) => [s.id, s.name]),
  );
  const prefs = await tx.execute<{ pushOn: boolean; emailOk: boolean }>(sql`
    select coalesce(p.push_enabled, false) as "pushOn",
           (coalesce(p.email_enabled, true) and u.email_verified_at is not null) as "emailOk"
      from app.users u
      left join app.notification_preferences p on p.user_id = u.id
     where u.id = ${input.userId}`);
  const pref = prefs.rows[0] ?? { pushOn: false, emailOk: false };

  for (const ev of linked) {
    const found = byKey.get(ev.externalGradeItemId!);
    if (!found || found.subjectId !== ev.subjectId) continue;
    const score =
      found.item.grade === null
        ? null
        : moodleScoreToCenti(found.item.grade, found.item.max, ev.maxScore);
    if (score === ev.score) continue;
    await tx.execute(sql`
      update app.evaluation_items
         set score = ${score}, scored_at = ${score === null ? null : sql`now()`}
       where id = ${ev.id} and score_source = 'moodle'`);
    result.updated++;
    if (score === null || input.notify === false) continue;
    result.posted++;
    const payload = JSON.stringify({
      subjectName: names.get(ev.subjectId) ?? "",
      itemName: ev.name,
      score,
      maxScore: ev.maxScore,
    });
    const dedupe = `grade_posted:${ev.id}:${score}`;
    const channels: [string, string][] = [["in_app", "sent"]];
    if (pref.pushOn) channels.push(["push", "pending"]);
    if (pref.emailOk) channels.push(["email", "pending"]);
    for (const [channel, status] of channels) {
      await tx.execute(sql`
        insert into app.notification_logs
          (user_id, subject_id, kind, channel, dedupe_key, status, payload, sent_at)
        values (${input.userId}, ${ev.subjectId}, 'grade_posted', ${channel}, ${dedupe},
                ${status}, ${payload}::jsonb, ${status === "sent" ? sql`now()` : null})
        on conflict (dedupe_key, channel) do nothing`);
    }
  }
  return result;
}
