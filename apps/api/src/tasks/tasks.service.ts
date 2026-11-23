import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CreateTaskBody,
  Task,
  TaskList,
  TaskListQuery,
  UpdateTaskBody,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { localParts, zonedTimeToUtc } from "@presenca/engine";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ClockService } from "../common/clock";
import { type IdempotentResult, IdempotencyService } from "../common/idempotency";
import { assertVersioned } from "../common/versioning";
import { DbService } from "../database/db.service";

const { tasks, subjects, users, notificationLogs } = schema;

const FALLBACK_TZ = "America/Sao_Paulo";

const invalid = (path: string, message: string) =>
  new UnprocessableEntityException({ code: "TASK_INVALID", errors: [{ path, message }] });
const taskNotFound = () => new NotFoundException({ detail: "Tarefa não encontrada." });

type TaskRow = typeof tasks.$inferSelect & {
  subjectName: string | null;
  subjectColor: string | null;
};

/**
 * Tarefas e entregas. O prazo chega como data e hora locais e é guardado como instante no fuso da
 * conta. Mudar o status, o prazo ou a antecedência (ou apagar) cancela os envios pendentes do aviso
 * na mesma transação; o aviso novo, se couber, sai no próximo ciclo do worker.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: ClockService,
  ) {}

  private async timezone(tx: Tx): Promise<string> {
    const [me] = await tx.select({ timezone: users.timezone }).from(users);
    return me?.timezone ?? FALLBACK_TZ;
  }

  private toInstant(local: string, tz: string): Date {
    const [date, time] = local.split("T") as [string, string];
    return zonedTimeToUtc(date, time, tz);
  }

  private toDto(row: TaskRow, tz: string): Task {
    const local = localParts(row.dueAt, tz);
    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      subjectId: row.subjectId,
      subject:
        row.subjectId && row.subjectName
          ? {
              id: row.subjectId,
              name: row.subjectName,
              color: row.subjectColor as NonNullable<Task["subject"]>["color"],
            }
          : null,
      dueAt: row.dueAt.toISOString(),
      dueLocal: { date: local.date, time: local.time },
      remindBeforeMinutes: row.remindBeforeMinutes,
      status: row.status,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      overdue: row.status === "pending" && row.dueAt.getTime() < this.clock.now().getTime(),
      version: row.version,
    };
  }

  private select(tx: Tx) {
    return tx
      .select({
        task: tasks,
        subjectName: subjects.name,
        subjectColor: subjects.color,
      })
      .from(tasks)
      .leftJoin(subjects, eq(subjects.id, tasks.subjectId));
  }

  private async load(tx: Tx, id: string): Promise<TaskRow | undefined> {
    const [row] = await this.select(tx).where(eq(tasks.id, id));
    return row
      ? { ...row.task, subjectName: row.subjectName, subjectColor: row.subjectColor }
      : undefined;
  }

  /** A matéria precisa ser do aluno (o RLS esconde as dos outros; a FK composta garante no banco). */
  private async assertSubject(tx: Tx, subjectId: string | null | undefined) {
    if (!subjectId) return;
    const [found] = await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId));
    if (!found) throw invalid("subjectId", "Matéria não encontrada.");
  }

  /** Envios de aviso ainda na fila (push/e-mail) desta tarefa deixam de valer. */
  private async cancelPending(tx: Tx, taskId: string, reason: string) {
    await tx
      .update(notificationLogs)
      .set({ status: "skipped", lastError: reason })
      .where(
        and(
          eq(notificationLogs.taskId, taskId),
          inArray(notificationLogs.channel, ["push", "email"]),
          inArray(notificationLogs.status, ["pending", "failed"]),
        ),
      );
  }

  // ---------------------------------------------------------------- criar

  create(body: CreateTaskBody, key: string): Promise<IdempotentResult<Task>> {
    return this.db.tx((tx) =>
      this.idempotency.run(tx, key, body, async () => ({
        status: 201,
        body: await this.createInTx(tx, body),
      })),
    );
  }

  private async createInTx(tx: Tx, body: CreateTaskBody): Promise<Task> {
    await this.assertSubject(tx, body.subjectId);
    const tz = await this.timezone(tx);
    const [row] = await tx
      .insert(tasks)
      .values({
        userId: sql`app.current_user_id()`,
        subjectId: body.subjectId ?? null,
        title: body.title.trim(),
        notes: body.notes ?? null,
        dueAt: this.toInstant(body.dueAt, tz),
        remindBeforeMinutes: body.remindBeforeMinutes ?? 1440,
      })
      .returning({ id: tasks.id });
    return this.toDto((await this.load(tx, row!.id))!, tz);
  }

  // ---------------------------------------------------------------- ler

  get(id: string): Promise<Task> {
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, id);
      if (!row) throw taskNotFound();
      return this.toDto(row, await this.timezone(tx));
    });
  }

  list(query: TaskListQuery): Promise<TaskList> {
    return this.db.tx(async (tx) => {
      const tz = await this.timezone(tx);
      const cursor = query.cursor ? decodeTaskCursor(query.cursor) : undefined;
      if (query.cursor && !cursor) throw invalid("cursor", "Cursor inválido. Recomece a listagem.");
      const asc_ = query.order === "due_asc";
      const filters: SQL[] = [];
      if (query.status) filters.push(eq(tasks.status, query.status));
      if (query.subjectId) filters.push(eq(tasks.subjectId, query.subjectId));
      if (cursor) {
        filters.push(
          asc_
            ? sql`(${tasks.dueAt}, ${tasks.id}) > (${cursor.dueAt}::timestamptz, ${cursor.id}::uuid)`
            : sql`(${tasks.dueAt}, ${tasks.id}) < (${cursor.dueAt}::timestamptz, ${cursor.id}::uuid)`,
        );
      }
      const rows = await this.select(tx)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(asc_ ? asc(tasks.dueAt) : desc(tasks.dueAt), asc_ ? asc(tasks.id) : desc(tasks.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        tasks: page.map((r) =>
          this.toDto({ ...r.task, subjectName: r.subjectName, subjectColor: r.subjectColor }, tz),
        ),
        nextCursor:
          rows.length > query.limit && last
            ? encodeTaskCursor(last.task.dueAt.toISOString(), last.task.id)
            : null,
      };
    });
  }

  // ---------------------------------------------------------------- editar

  update(id: string, expectedVersion: number, body: UpdateTaskBody): Promise<Task> {
    return this.db.tx(async (tx) => {
      const current = await this.load(tx, id);
      if (!current) throw taskNotFound();
      if (body.subjectId !== undefined) await this.assertSubject(tx, body.subjectId);
      const tz = await this.timezone(tx);

      const patch: Partial<typeof tasks.$inferInsert> = {};
      if (body.title !== undefined) patch.title = body.title.trim();
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.subjectId !== undefined) patch.subjectId = body.subjectId;
      if (body.dueAt !== undefined) patch.dueAt = this.toInstant(body.dueAt, tz);
      if (body.remindBeforeMinutes !== undefined)
        patch.remindBeforeMinutes = body.remindBeforeMinutes;
      if (body.status !== undefined && body.status !== current.status) {
        patch.status = body.status;
        patch.resolvedAt = body.status === "pending" ? null : this.clock.now();
      }

      const rows = await tx
        .update(tasks)
        .set(patch)
        .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
        .returning({ id: tasks.id });
      await assertVersioned(rows, async () => true, "Tarefa não encontrada.");

      const dueChanged =
        patch.dueAt !== undefined && patch.dueAt.getTime() !== current.dueAt.getTime();
      const remindChanged =
        patch.remindBeforeMinutes !== undefined &&
        patch.remindBeforeMinutes !== current.remindBeforeMinutes;
      const resolved = patch.status !== undefined && patch.status !== "pending";
      if (dueChanged || remindChanged || resolved) {
        await this.cancelPending(
          tx,
          id,
          resolved ? "tarefa marcada pelo aluno" : "prazo ou antecedência alterados",
        );
      }
      return this.toDto((await this.load(tx, id))!, tz);
    });
  }

  // ---------------------------------------------------------------- apagar

  remove(id: string, expectedVersion: number): Promise<void> {
    return this.db.tx(async (tx) => {
      const current = await this.load(tx, id);
      if (!current) throw taskNotFound();
      if (current.version !== expectedVersion) {
        await assertVersioned([], async () => true, "Tarefa não encontrada.");
      }
      await this.cancelPending(tx, id, "tarefa apagada");
      const rows = await tx
        .delete(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
        .returning({ id: tasks.id });
      await assertVersioned(rows, async () => true, "Tarefa não encontrada.");
    });
  }
}

// Cursor opaco: base64url de "instante ISO|uuid" (ordem por prazo e, no empate, por id).
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function encodeTaskCursor(dueAt: string, id: string): string {
  return Buffer.from(`${dueAt}|${id}`).toString("base64url");
}

export function decodeTaskCursor(cursor: string): { dueAt: string; id: string } | undefined {
  const match = CURSOR.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match ? { dueAt: match[1]!, id: match[2]! } : undefined;
}
