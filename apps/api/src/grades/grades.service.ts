import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  type EvaluationItemDto,
  GradesErrorCode,
  type GradingRulesDto,
  type SaveGradingBody,
  saveGradingBodySchema,
  type SubjectGrading,
  type GradesOverview,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import {
  type EvaluationItem,
  summarizeGrades,
  validateGrading,
  zonedTimeToUtc,
} from "@presenca/engine";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { ClockService } from "../common/clock";
import { inOrder } from "../common/in-order";
import { assertVersioned, parseIfMatch } from "../common/versioning";
import { DbService } from "../database/db.service";
import { cancelTaskNotifications } from "../tasks/tasks.service";
import { GRADING_AI, type GradingAi } from "./assistant.service";

const { gradingSchemes, evaluationItems, subjects, tasks, users } = schema;

const invalid = (errors: { path: string; message: string }[]) =>
  new UnprocessableEntityException({ code: GradesErrorCode.invalid, errors });

type ItemRow = typeof evaluationItems.$inferSelect;

const toEngine = (r: ItemRow): EvaluationItem => ({
  key: r.key,
  name: r.name,
  maxScore: r.maxScore,
  group: r.groupKey,
  role: r.role as EvaluationItem["role"],
  score: r.score,
});

/**
 * Notas de uma matéria: regra de cálculo (como o professor quiser), avaliações e o resumo calculado
 * na hora pelo motor. Salvar troca a regra e a lista de avaliações numa transação, mantendo as
 * notas das avaliações que continuam.
 */
@Injectable()
export class GradesService {
  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
    @Inject(GRADING_AI) private readonly ai: GradingAi | null,
  ) {}

  /** Aba Notas: todas as matérias do semestre atual, com consultas em lote (não uma por matéria). */
  overview(): Promise<GradesOverview> {
    return this.db.tx(async (tx) => {
      const [current] = await tx
        .select({ id: schema.semesters.id })
        .from(schema.semesters)
        .where(eq(schema.semesters.isCurrent, true))
        .limit(1);
      if (!current) return { subjects: [] };
      const list = await tx
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(and(eq(subjects.semesterId, current.id), isNull(subjects.archivedAt)))
        .orderBy(asc(subjects.name));
      const ids = list.map((s) => s.id);
      if (ids.length === 0) return { subjects: [] };
      const [schemes, rows] = await inOrder([
        tx
          .select({ subjectId: gradingSchemes.subjectId, rules: gradingSchemes.rules })
          .from(gradingSchemes)
          .where(inArray(gradingSchemes.subjectId, ids)),
        tx.select().from(evaluationItems).where(inArray(evaluationItems.subjectId, ids)),
      ]);
      return {
        subjects: list.map((s) => {
          const items = rows.filter((r) => r.subjectId === s.id);
          const raw = schemes.find((x) => x.subjectId === s.id);
          const rules = raw ? saveGradingBodySchema.shape.rules.safeParse(raw.rules) : null;
          let summary: GradesOverview["subjects"][number]["summary"] = null;
          if (rules?.success) {
            try {
              summary = summarizeGrades(rules.data, items.map(toEngine));
            } catch {
              summary = null;
            }
          }
          return {
            subjectId: s.id,
            name: s.name,
            passing: rules?.success ? rules.data.passing : null,
            summary,
            scored: items.filter((i) => i.score !== null).length,
            total: items.length,
          };
        }),
      };
    });
  }

  get(subjectId: string): Promise<SubjectGrading> {
    return this.db.tx((tx) => this.load(tx, subjectId));
  }

  private async load(tx: Tx, subjectId: string): Promise<SubjectGrading> {
    const [subject] = await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId));
    if (!subject) throw new NotFoundException({ detail: "Matéria não encontrada." });
    const [scheme] = await tx
      .select({
        rules: gradingSchemes.rules,
        source: gradingSchemes.source,
        version: gradingSchemes.version,
      })
      .from(gradingSchemes)
      .where(eq(gradingSchemes.subjectId, subjectId));
    const rows = await tx
      .select()
      .from(evaluationItems)
      .where(eq(evaluationItems.subjectId, subjectId))
      .orderBy(asc(evaluationItems.position), asc(evaluationItems.createdAt));
    const linked =
      rows.length === 0
        ? []
        : await tx
            .select({
              id: tasks.id,
              title: tasks.title,
              status: tasks.status,
              evaluationItemId: tasks.evaluationItemId,
            })
            .from(tasks)
            .where(
              and(
                isNotNull(tasks.evaluationItemId),
                inArray(
                  tasks.evaluationItemId,
                  rows.map((r) => r.id),
                ),
              ),
            )
            .orderBy(asc(tasks.dueAt));
    const items: EvaluationItemDto[] = rows.map((r) => {
      const task = linked.find((t) => t.evaluationItemId === r.id);
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        maxScore: r.maxScore,
        group: r.groupKey,
        role: r.role as EvaluationItemDto["role"],
        dueOn: r.dueOn,
        score: r.score,
        scoreSource: r.scoreSource as EvaluationItemDto["scoreSource"],
        externalGradeItemId: r.externalGradeItemId,
        task: task ? { id: task.id, title: task.title, status: task.status } : null,
        version: r.version,
      };
    });
    let summary: SubjectGrading["summary"] = null;
    let rules: GradingRulesDto | null = null;
    if (scheme) {
      // A regra guardada passou pela validação ao salvar; relê pelo contrato por segurança.
      const parsed = saveGradingBodySchema.shape.rules.safeParse(scheme.rules);
      if (parsed.success) {
        rules = parsed.data;
        try {
          summary = summarizeGrades(rules, rows.map(toEngine));
        } catch {
          summary = null;
        }
      }
    }
    // Moodle com token e turma ligada a esta matéria: a tela oferece ligar as avaliações.
    const [linkable] = await tx
      .select({ id: schema.moodleCourseMappings.id })
      .from(schema.moodleCourseMappings)
      .innerJoin(
        schema.moodleConnections,
        eq(schema.moodleConnections.userId, schema.moodleCourseMappings.userId),
      )
      .where(
        and(
          eq(schema.moodleCourseMappings.subjectId, subjectId),
          eq(schema.moodleCourseMappings.ignored, false),
          isNotNull(schema.moodleConnections.wstokenEnc),
        ),
      )
      .limit(1);
    return {
      subjectId,
      assistantAvailable: this.ai !== null,
      moodleLinkable: linkable !== undefined,
      scheme:
        scheme && rules
          ? { rules, source: scheme.source as "manual" | "ai", version: scheme.version }
          : null,
      items,
      summary,
    };
  }

  async save(
    subjectId: string,
    ifMatch: string | undefined,
    input: SaveGradingBody,
  ): Promise<SubjectGrading> {
    const body = saveGradingBodySchema.parse(input);
    const errors = validateGrading(
      body.rules,
      body.items.map((i) => ({
        key: i.key,
        name: i.name,
        maxScore: i.maxScore,
        group: i.group,
        role: i.role,
      })),
    );
    body.items.forEach((it, i) => {
      if (it.createTask && !it.dueOn) {
        errors.push({ path: `items.${i}.dueOn`, message: "Informe a data para criar a tarefa." });
      }
    });
    if (errors.length > 0) throw invalid(errors);

    return this.db.tx(async (tx) => {
      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.id, subjectId));
      if (!subject) throw new NotFoundException({ detail: "Matéria não encontrada." });
      const [current] = await tx
        .select({ version: gradingSchemes.version })
        .from(gradingSchemes)
        .where(eq(gradingSchemes.subjectId, subjectId));

      if (current) {
        const expected = parseIfMatch(ifMatch);
        const rows = await tx
          .update(gradingSchemes)
          .set({ rules: body.rules, source: body.source })
          .where(and(eq(gradingSchemes.subjectId, subjectId), eq(gradingSchemes.version, expected)))
          .returning({ id: gradingSchemes.id });
        await assertVersioned(rows, async () => true, "Matéria não encontrada.");
      } else {
        await tx.insert(gradingSchemes).values({
          userId: sql`app.current_user_id()`,
          subjectId,
          rules: body.rules,
          source: body.source,
        });
      }

      // Avaliações: as que vieram com id são atualizadas (mantendo a nota), as novas inseridas e
      // as que sumiram, apagadas (a tarefa ligada só perde a ligação).
      const existing = await tx
        .select()
        .from(evaluationItems)
        .where(eq(evaluationItems.subjectId, subjectId));
      const keepIds = body.items.map((i) => i.id).filter((id): id is string => !!id);
      const unknown = keepIds.filter((id) => !existing.some((e) => e.id === id));
      if (unknown.length > 0)
        throw invalid([{ path: "items", message: "Avaliação não encontrada." }]);
      await tx
        .delete(evaluationItems)
        .where(
          keepIds.length > 0
            ? and(eq(evaluationItems.subjectId, subjectId), notInArray(evaluationItems.id, keepIds))
            : eq(evaluationItems.subjectId, subjectId),
        );
      // Troca de nomes em lote sem esbarrar no índice único (P1 ↔ P2): primeiro nomes temporários.
      for (const id of keepIds) {
        await tx
          .update(evaluationItems)
          .set({ key: `__${id.slice(-12)}` })
          .where(eq(evaluationItems.id, id));
      }
      const [me] = await tx.select({ timezone: users.timezone }).from(users);
      const tz = me?.timezone ?? "America/Sao_Paulo";
      for (const [position, it] of body.items.entries()) {
        const values = {
          key: it.key,
          name: it.name,
          maxScore: it.maxScore,
          groupKey: it.group,
          role: it.role,
          dueOn: it.dueOn,
          position,
        };
        let itemId = it.id;
        if (it.id) {
          const before = existing.find((e) => e.id === it.id)!;
          if (before.score !== null && before.score > it.maxScore) {
            throw invalid([
              {
                path: `items.${position}.maxScore`,
                message: "Já há uma nota maior que essa nota máxima.",
              },
            ]);
          }
          await tx.update(evaluationItems).set(values).where(eq(evaluationItems.id, it.id));
        } else {
          const [row] = await tx
            .insert(evaluationItems)
            .values({ userId: sql`app.current_user_id()`, subjectId, ...values })
            .returning({ id: evaluationItems.id });
          itemId = row!.id;
        }
        if (it.createTask && it.dueOn) {
          const [already] = await tx
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.evaluationItemId, itemId!));
          if (!already) {
            await tx.insert(tasks).values({
              userId: sql`app.current_user_id()`,
              subjectId,
              title: it.name,
              dueAt: zonedTimeToUtc(it.dueOn, "23:59", tz),
              evaluationItemId: itemId,
            });
          }
        }
      }
      return this.load(tx, subjectId);
    });
  }

  setScore(
    itemId: string,
    expectedVersion: number,
    score: number | null,
    completeTask = false,
  ): Promise<SubjectGrading> {
    return this.db.tx(async (tx) => {
      const [item] = await tx
        .select({ subjectId: evaluationItems.subjectId, maxScore: evaluationItems.maxScore })
        .from(evaluationItems)
        .where(eq(evaluationItems.id, itemId));
      if (!item) throw new NotFoundException({ detail: "Avaliação não encontrada." });
      if (score !== null && score > item.maxScore) {
        throw invalid([{ path: "score", message: "A nota passa da nota máxima da avaliação." }]);
      }
      const rows = await tx
        .update(evaluationItems)
        .set({
          score,
          scoreSource: "user",
          scoredAt: score === null ? null : this.clock.now(),
        })
        .where(and(eq(evaluationItems.id, itemId), eq(evaluationItems.version, expectedVersion)))
        .returning({ id: evaluationItems.id });
      await assertVersioned(rows, async () => true, "Avaliação não encontrada.");
      if (completeTask && score !== null) {
        // Nota lançada = entregue: a tarefa ligada que ainda estava pendente vira concluída.
        const done = await tx
          .update(schema.tasks)
          .set({ status: "completed", statusSource: "user", resolvedAt: this.clock.now() })
          .where(and(eq(schema.tasks.evaluationItemId, itemId), eq(schema.tasks.status, "pending")))
          .returning({ id: schema.tasks.id });
        for (const t of done) await cancelTaskNotifications(tx, t.id, "nota lançada");
      }
      return this.load(tx, item.subjectId);
    });
  }
}
