import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  type MoodleConnectBody,
  type MoodleCourse,
  type MoodleGradeLinksBody,
  type MoodleGrades,
  type MoodleCourseBody,
  MoodleErrorCode,
  type MoodleStatus,
  type MoodleSyncResult,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import {
  applyMoodleGrades,
  describeSyncError,
  fetchCourseGrades,
  gradeItemKey,
  type MoodleGradeItem,
  normalizeTitle,
  detachImportedTasks,
  enrichWithApi,
  fetchIcsDeadlines,
  maskUrl,
  type MoodleDeadline,
  moodleClient,
  normalizeBaseUrl,
  openSecret,
  reconcileDeadlines,
  type SafeFetchOptions,
  sealSecret,
  secretAad,
} from "@presenca/integrations";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { ClockService } from "../common/clock";
import { type IdempotentResult, IdempotencyService } from "../common/idempotency";
import { requestContext } from "../common/request-context";
import { assertVersioned } from "../common/versioning";
import { ENV, type Env } from "../config/env";
import { DbService } from "../database/db.service";

const { moodleConnections, moodleCourseMappings, tasks, subjects, users, notificationLogs } =
  schema;

const SYNC_EVERY_MIN = 45;
const FALLBACK_TZ = "America/Sao_Paulo";

const invalid = (path: string, message: string) =>
  new UnprocessableEntityException({ code: MoodleErrorCode.invalid, errors: [{ path, message }] });
const notConnected = () =>
  new NotFoundException({
    code: MoodleErrorCode.notConnected,
    detail: "O Moodle não está conectado.",
  });

interface Credentials {
  icsUrl: string;
  baseUrl: string | null;
  wstoken: string | null;
}

/**
 * Conector do Moodle do lado da API: conectar (testa o link antes de guardar), sincronizar na hora,
 * ligar turmas a matérias e desconectar. A busca na rede acontece fora da transação; a gravação
 * (reconciliação) é a mesma do worker (packages/integrations).
 */
@Injectable()
export class MoodleService {
  private readonly key: Buffer | null;
  private readonly fetchOptions: SafeFetchOptions;

  constructor(
    private readonly db: DbService,
    private readonly clock: ClockService,
    private readonly idempotency: IdempotencyService,
    @Inject(ENV) env: Env,
  ) {
    this.key = env.INTEGRATION_ENCRYPTION_KEY
      ? Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, "base64")
      : null;
    this.fetchOptions = env.INTEGRATIONS_ALLOW_INSECURE_FETCH
      ? { allowHttp: true, allowPrivate: true }
      : {};
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException({
        code: MoodleErrorCode.unavailable,
        detail: "A integração com o Moodle não está ligada neste servidor.",
      });
    }
    return this.key;
  }

  private userId(): string {
    const id = requestContext.get()?.userId;
    if (!id) throw new Error("MoodleService fora de uma requisição autenticada");
    return id;
  }

  // ---------------------------------------------------------------- estado

  status(): Promise<MoodleStatus> {
    return this.db.tx((tx) => this.statusTx(tx));
  }

  private async statusTx(tx: Tx): Promise<MoodleStatus> {
    const available = this.key !== null;
    const [conn] = await tx
      .select({
        icsHost: moodleConnections.icsHost,
        baseUrl: moodleConnections.baseUrl,
        hasToken: sql<boolean>`${moodleConnections.wstokenEnc} is not null`,
        syncEnabled: moodleConnections.syncEnabled,
        lastSyncAt: moodleConnections.lastSyncAt,
        lastSyncError: moodleConnections.lastSyncError,
        nextSyncAt: moodleConnections.nextSyncAt,
        version: moodleConnections.version,
      })
      .from(moodleConnections);
    if (!conn) return { available, connection: null };
    const courses = await this.coursesTx(tx);
    const [imported] = await tx
      .select({ n: count() })
      .from(tasks)
      .where(sql`${tasks.source} <> 'manual'`);
    return {
      available,
      connection: {
        icsHost: conn.icsHost,
        baseUrlHost: conn.baseUrl ? maskUrl(conn.baseUrl) : null,
        hasToken: conn.hasToken,
        syncEnabled: conn.syncEnabled,
        lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
        lastSyncError: conn.lastSyncError,
        nextSyncAt: conn.nextSyncAt.toISOString(),
        importedCount: imported?.n ?? 0,
        courses,
        version: conn.version,
      },
    };
  }

  private async coursesTx(tx: Tx, id?: string): Promise<MoodleCourse[]> {
    const rows = await tx
      .select({
        id: moodleCourseMappings.id,
        courseKey: moodleCourseMappings.courseKey,
        subjectId: moodleCourseMappings.subjectId,
        subjectName: subjects.name,
        ignored: moodleCourseMappings.ignored,
        version: moodleCourseMappings.version,
        taskCount: sql<number>`(
          select count(*)::int from app.tasks t
           where t.external_course_key = ${moodleCourseMappings.courseKey}
             and t.source <> 'manual')`,
      })
      .from(moodleCourseMappings)
      .leftJoin(subjects, eq(subjects.id, moodleCourseMappings.subjectId))
      .where(id ? eq(moodleCourseMappings.id, id) : undefined)
      .orderBy(moodleCourseMappings.courseKey);
    return rows.map((r) => ({ ...r, subjectName: r.subjectId ? r.subjectName : null }));
  }

  // ---------------------------------------------------------------- conectar

  async connect(body: MoodleConnectBody): Promise<MoodleSyncResult> {
    const key = this.requireKey();
    const userId = this.userId();
    const now = this.clock.now();

    // 1. O que já está guardado (para completar o que o aluno não mandou de novo).
    const current = await this.db.tx(async (tx) => {
      const [row] = await tx
        .select({
          icsUrlEnc: moodleConnections.icsUrlEnc,
          baseUrl: moodleConnections.baseUrl,
          wstokenEnc: moodleConnections.wstokenEnc,
          syncEnabled: moodleConnections.syncEnabled,
        })
        .from(moodleConnections);
      const [me] = await tx.select({ timezone: users.timezone }).from(users);
      return { row, timezone: me?.timezone ?? FALLBACK_TZ };
    });
    const stored = current.row ? this.open(current.row, userId, key) : null;
    const creds: Credentials = {
      icsUrl: body.icsUrl ?? stored?.icsUrl ?? "",
      baseUrl:
        body.baseUrl !== undefined
          ? body.baseUrl && normalizeBaseUrl(body.baseUrl)
          : (stored?.baseUrl ?? null),
      wstoken: body.wstoken !== undefined ? body.wstoken : (stored?.wstoken ?? null),
    };
    if (!creds.icsUrl) throw invalid("icsUrl", "Cole o link do calendário do Moodle.");
    if (creds.wstoken && !creds.baseUrl) {
      throw invalid("baseUrl", "Informe o endereço do Moodle para usar a chave de segurança.");
    }

    // 2. Testa antes de guardar (fora da transação: é rede).
    let deadlines: MoodleDeadline[];
    try {
      deadlines = await fetchIcsDeadlines(creds.icsUrl, current.timezone, this.fetchOptions);
    } catch (error) {
      throw invalid("icsUrl", describeSyncError(error));
    }
    let warning: string | null = null;
    if (creds.wstoken && creds.baseUrl) {
      try {
        deadlines = await enrichWithApi(
          deadlines,
          moodleClient(creds.baseUrl, creds.wstoken, this.fetchOptions),
          creds.baseUrl,
          now,
        );
      } catch (error) {
        // Chave nova que não funciona: avisa no campo. Chave antiga que parou: segue com o .ics.
        if (body.wstoken) throw invalid("wstoken", describeSyncError(error));
        warning = `Parcial: ${describeSyncError(error)}`;
      }
    }

    // 3. Guarda cifrado e aplica.
    return this.db.tx(async (tx) => {
      const values = {
        icsHost: maskUrl(creds.icsUrl),
        icsUrlEnc: sealSecret(creds.icsUrl, key, secretAad(userId, "ics_url")),
        baseUrl: creds.baseUrl,
        wstokenEnc: creds.wstoken
          ? sealSecret(creds.wstoken, key, secretAad(userId, "wstoken"))
          : null,
        syncEnabled: body.syncEnabled ?? current.row?.syncEnabled ?? true,
        lastSyncAt: now,
        lastSyncError: warning,
        nextSyncAt: new Date(now.getTime() + SYNC_EVERY_MIN * 60_000),
      };
      await tx
        .insert(moodleConnections)
        .values({ userId: sql`app.current_user_id()`, ...values })
        .onConflictDoUpdate({
          target: moodleConnections.userId,
          set: { ...values, version: sql`${moodleConnections.version} + 1` },
        });
      const result = await reconcileDeadlines(tx, { userId, deadlines, now });
      return { ...result, warning, status: await this.statusTx(tx) };
    });
  }

  private open(
    row: { icsUrlEnc: string; baseUrl: string | null; wstokenEnc: string | null },
    userId: string,
    key: Buffer,
  ): Credentials | null {
    try {
      return {
        icsUrl: openSecret(row.icsUrlEnc, key, secretAad(userId, "ics_url")),
        baseUrl: row.baseUrl,
        wstoken: row.wstokenEnc
          ? openSecret(row.wstokenEnc, key, secretAad(userId, "wstoken"))
          : null,
      };
    } catch {
      return null; // chave do servidor trocada: o aluno precisa colar o link de novo
    }
  }

  // ---------------------------------------------------------------- sincronizar agora

  async sync(idempotencyKey: string): Promise<IdempotentResult<MoodleSyncResult>> {
    const key = this.requireKey();
    const userId = this.userId();
    const now = this.clock.now();
    const loaded = await this.db.tx(async (tx) => {
      const [row] = await tx
        .select({
          icsUrlEnc: moodleConnections.icsUrlEnc,
          baseUrl: moodleConnections.baseUrl,
          wstokenEnc: moodleConnections.wstokenEnc,
        })
        .from(moodleConnections);
      const [me] = await tx.select({ timezone: users.timezone }).from(users);
      return { row, timezone: me?.timezone ?? FALLBACK_TZ };
    });
    if (!loaded.row) throw notConnected();
    const creds = this.open(loaded.row, userId, key);

    let deadlines: MoodleDeadline[] = [];
    let error: string | null = null;
    let warning: string | null = null;
    if (!creds) {
      error = "Não foi possível abrir os dados da conexão. Conecte o Moodle de novo.";
    } else {
      try {
        deadlines = await fetchIcsDeadlines(creds.icsUrl, loaded.timezone, this.fetchOptions);
        if (creds.wstoken && creds.baseUrl) {
          try {
            deadlines = await enrichWithApi(
              deadlines,
              moodleClient(creds.baseUrl, creds.wstoken, this.fetchOptions),
              creds.baseUrl,
              now,
            );
          } catch (e) {
            warning = `Parcial: ${describeSyncError(e)}`;
          }
        }
      } catch (e) {
        error = describeSyncError(e);
      }
    }

    if (error) {
      // Registra a falha para a tela mostrar, e responde 422 com a mesma mensagem.
      await this.db.tx((tx) =>
        tx
          .update(moodleConnections)
          .set({ lastSyncAt: now, lastSyncError: error })
          .where(eq(moodleConnections.userId, sql`app.current_user_id()`)),
      );
      throw invalid("icsUrl", error);
    }

    return this.db.tx((tx) =>
      this.idempotency.run(tx, idempotencyKey, {}, async () => {
        const result = await reconcileDeadlines(tx, { userId, deadlines, now });
        await tx
          .update(moodleConnections)
          .set({
            lastSyncAt: now,
            lastSyncError: warning,
            nextSyncAt: new Date(now.getTime() + SYNC_EVERY_MIN * 60_000),
          })
          .where(eq(moodleConnections.userId, sql`app.current_user_id()`));
        return { status: 200, body: { ...result, warning, status: await this.statusTx(tx) } };
      }),
    );
  }

  // ---------------------------------------------------------------- turmas

  updateCourse(id: string, expectedVersion: number, body: MoodleCourseBody): Promise<MoodleCourse> {
    return this.db.tx(async (tx) => {
      const [current] = await tx
        .select({
          courseKey: moodleCourseMappings.courseKey,
          subjectId: moodleCourseMappings.subjectId,
          ignored: moodleCourseMappings.ignored,
        })
        .from(moodleCourseMappings)
        .where(eq(moodleCourseMappings.id, id));
      if (!current) throw new NotFoundException({ detail: "Turma não encontrada." });
      if (body.subjectId) {
        const [found] = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(eq(subjects.id, body.subjectId));
        if (!found) throw invalid("subjectId", "Matéria não encontrada.");
      }
      // Ignorar desliga o vínculo; escolher uma matéria tira o "ignorar".
      let subjectId = current.subjectId;
      let nextIgnored = current.ignored;
      if (body.ignored !== undefined) {
        nextIgnored = body.ignored;
        if (nextIgnored) subjectId = null;
      }
      if (body.subjectId !== undefined) {
        subjectId = body.subjectId;
        if (subjectId) nextIgnored = false;
      }
      const rows = await tx
        .update(moodleCourseMappings)
        .set({ subjectId, ignored: nextIgnored, version: sql`${moodleCourseMappings.version} + 1` })
        .where(
          and(eq(moodleCourseMappings.id, id), eq(moodleCourseMappings.version, expectedVersion)),
        )
        .returning({ id: moodleCourseMappings.id });
      await assertVersioned(rows, async () => true, "Turma não encontrada.");

      const importedOfCourse = and(
        eq(tasks.externalCourseKey, current.courseKey),
        sql`${tasks.source} <> 'manual'`,
      );
      if (nextIgnored) {
        // Turma ignorada: some com as tarefas dela que ainda vão vencer (e com os avisos na fila).
        const doomed = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(importedOfCourse, eq(tasks.status, "pending"), gt(tasks.dueAt, this.clock.now())),
          );
        await this.dropTasks(
          tx,
          doomed.map((t) => t.id),
          "turma ignorada pelo aluno",
        );
      } else if (subjectId !== current.subjectId) {
        await tx.update(tasks).set({ subjectId }).where(importedOfCourse);
      }
      return (await this.coursesTx(tx, id))[0]!;
    });
  }

  private async dropTasks(tx: Tx, ids: string[], reason: string) {
    if (ids.length === 0) return;
    await tx
      .update(notificationLogs)
      .set({ status: "skipped", lastError: reason })
      .where(
        and(
          inArray(notificationLogs.taskId, ids),
          inArray(notificationLogs.channel, ["push", "email"]),
          inArray(notificationLogs.status, ["pending", "failed"]),
        ),
      );
    await tx.delete(tasks).where(inArray(tasks.id, ids));
  }

  // ---------------------------------------------------------------- desconectar

  disconnect(expectedVersion: number, keepTasks: boolean): Promise<void> {
    return this.db.tx(async (tx) => {
      const [conn] = await tx
        .select({ version: moodleConnections.version })
        .from(moodleConnections);
      if (!conn) throw notConnected();
      if (conn.version !== expectedVersion) {
        await assertVersioned([], async () => true, "O Moodle não está conectado.");
      }
      if (!keepTasks) {
        const doomed = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              sql`${tasks.source} <> 'manual'`,
              eq(tasks.status, "pending"),
              gt(tasks.dueAt, this.clock.now()),
            ),
          );
        await this.dropTasks(
          tx,
          doomed.map((t) => t.id),
          "Moodle desconectado",
        );
      }
      await detachImportedTasks(tx, this.userId());
      // Apaga link e chave (as turmas vão junto, em cascata).
      await tx.delete(moodleConnections).where(eq(moodleConnections.version, expectedVersion));
    });
  }

  // ---------------------------------------------------------------- notas do Moodle

  /** Itens do livro de notas da turma ligada a esta matéria (busca ao vivo no Moodle). */
  async subjectGrades(subjectId: string): Promise<MoodleGrades> {
    const loaded = await this.gradeContext(subjectId);
    if ("reason" in loaded)
      return { available: false, reason: loaded.reason, courseKey: null, items: [] };
    let items: MoodleGradeItem[];
    try {
      items = await this.fetchGradeItems(loaded);
    } catch (error) {
      return {
        available: false,
        reason: `Não foi possível ler as notas do Moodle: ${describeSyncError(error)}`,
        courseKey: loaded.courseKey,
        items: [],
      };
    }
    return this.describeGrades(subjectId, loaded.courseKey, items);
  }

  /**
   * Liga ou desliga avaliações a itens do Moodle. Ligada e sem nota do aluno: passa a seguir o
   * Moodle (score_source = 'moodle') e já recebe a nota que estiver lá, sem aviso. Nota lançada
   * pelo aluno continua dele. Desligar devolve a nota ao aluno.
   */
  async linkGrades(subjectId: string, body: MoodleGradeLinksBody): Promise<MoodleGrades> {
    const loaded = await this.gradeContext(subjectId);
    if ("reason" in loaded) {
      throw new UnprocessableEntityException({
        code: MoodleErrorCode.invalid,
        detail: loaded.reason,
      });
    }
    const items = await this.fetchGradeItems(loaded);
    const valid = new Set(items.map((i) => gradeItemKey(i.id)));
    await this.db.tx(async (tx) => {
      const own = await tx
        .select({ id: schema.evaluationItems.id, score: schema.evaluationItems.score })
        .from(schema.evaluationItems)
        .where(eq(schema.evaluationItems.subjectId, subjectId));
      const byId = new Map(own.map((o) => [o.id, o]));
      for (const link of body.links) {
        const ev = byId.get(link.evaluationItemId);
        if (!ev) throw invalid("links", "A avaliação precisa ser desta matéria.");
        if (link.externalGradeItemId !== null && !valid.has(link.externalGradeItemId)) {
          throw invalid("links", "Item do Moodle não encontrado nesta turma.");
        }
        await tx
          .update(schema.evaluationItems)
          .set(
            link.externalGradeItemId === null
              ? { externalGradeItemId: null, scoreSource: "user" }
              : {
                  externalGradeItemId: link.externalGradeItemId,
                  ...(ev.score === null ? { scoreSource: "moodle" } : {}),
                },
          )
          .where(eq(schema.evaluationItems.id, ev.id));
      }
      await applyMoodleGrades(tx, {
        userId: loaded.userId,
        grades: new Map([[loaded.courseKey, items]]),
        courses: new Map([[loaded.courseKey, subjectId]]),
        notify: false,
      });
    });
    return this.describeGrades(subjectId, loaded.courseKey, items);
  }

  private async gradeContext(
    subjectId: string,
  ): Promise<
    { reason: string } | { userId: string; courseKey: string; baseUrl: string; wstoken: string }
  > {
    const key = this.requireKey();
    const userId = this.userId();
    const found = await this.db.tx(async (tx) => {
      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.id, subjectId));
      if (!subject) throw new NotFoundException({ detail: "Matéria não encontrada." });
      const [row] = await tx
        .select({
          icsUrlEnc: moodleConnections.icsUrlEnc,
          baseUrl: moodleConnections.baseUrl,
          wstokenEnc: moodleConnections.wstokenEnc,
        })
        .from(moodleConnections);
      const [mapping] = await tx
        .select({ courseKey: moodleCourseMappings.courseKey })
        .from(moodleCourseMappings)
        .where(
          and(
            eq(moodleCourseMappings.subjectId, subjectId),
            eq(moodleCourseMappings.ignored, false),
          ),
        )
        .limit(1);
      return { row, mapping };
    });
    if (!found.row) return { reason: "Conecte o Moodle em Conta → Moodle." };
    if (!found.row.wstokenEnc || !found.row.baseUrl) {
      return {
        reason:
          "Para trazer as notas, conecte o Moodle com o token do aplicativo (Conta → Moodle).",
      };
    }
    if (!found.mapping) {
      return { reason: "Ligue a turma do Moodle a esta matéria em Conta → Moodle." };
    }
    const creds = this.open(found.row, userId, key);
    if (!creds?.wstoken || !creds.baseUrl) {
      return { reason: "Não foi possível abrir os dados da conexão. Conecte o Moodle de novo." };
    }
    return {
      userId,
      courseKey: found.mapping.courseKey,
      baseUrl: creds.baseUrl,
      wstoken: creds.wstoken,
    };
  }

  private async fetchGradeItems(ctx: {
    courseKey: string;
    baseUrl: string;
    wstoken: string;
  }): Promise<MoodleGradeItem[]> {
    const grades = await fetchCourseGrades(
      moodleClient(ctx.baseUrl, ctx.wstoken, this.fetchOptions),
      [ctx.courseKey],
    );
    return grades.get(ctx.courseKey) ?? [];
  }

  private async describeGrades(
    subjectId: string,
    courseKey: string,
    items: MoodleGradeItem[],
  ): Promise<MoodleGrades> {
    const evaluations = await this.db.tx((tx) =>
      tx
        .select({
          id: schema.evaluationItems.id,
          name: schema.evaluationItems.name,
          externalGradeItemId: schema.evaluationItems.externalGradeItemId,
        })
        .from(schema.evaluationItems)
        .where(eq(schema.evaluationItems.subjectId, subjectId)),
    );
    const linkedIds = new Set(evaluations.map((e) => e.externalGradeItemId).filter(Boolean));
    return {
      available: true,
      reason: null,
      courseKey,
      items: items.map((item) => {
        const externalId = gradeItemKey(item.id);
        const linked = evaluations.find((e) => e.externalGradeItemId === externalId);
        const suggested =
          linked || linkedIds.has(externalId)
            ? undefined
            : evaluations.find(
                (e) =>
                  !e.externalGradeItemId && normalizeTitle(e.name) === normalizeTitle(item.name),
              );
        return {
          externalId,
          name: item.name,
          grade: item.grade,
          max: item.max,
          linkedTo: linked?.id ?? null,
          suggested: suggested?.id ?? null,
        };
      }),
    };
  }
}
