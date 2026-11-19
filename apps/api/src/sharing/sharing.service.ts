import { randomBytes } from "node:crypto";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  type CreateTemplateBody,
  type ImportTemplateBody,
  type ImportTemplateResult,
  type SemesterTemplatePayload,
  semesterTemplatePayloadSchema,
  SHARE_CODE_ALPHABET,
  type SharedTemplate,
  SharingErrorCode,
  type SubjectTemplatePayload,
  subjectTemplatePayloadSchema,
  type TemplatePreview,
  type TemplateSubject,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { scheduleColumns, subjectColumns } from "../academic/mappers";
import { isUniqueViolation } from "../auth/user-mapper";
import { ClockService } from "../common/clock";
import { type IdempotentResult, IdempotencyService } from "../common/idempotency";
import { DbService } from "../database/db.service";
import { subjectToTemplate, toPreview, toSharedTemplate } from "./sharing.mapper";
import { inOrder } from "../common/in-order";

const {
  sharedTemplates,
  templateImports,
  semesters,
  subjects,
  subjectSchedules,
  calendarExceptions,
} = schema;

/** Códigos ativos por aluno: o bastante para compartilhar com várias turmas, pouco para abuso. */
export const MAX_ACTIVE_TEMPLATES = 20;

const notFound = () =>
  new NotFoundException({
    code: SharingErrorCode.notFound,
    detail:
      "Código não encontrado. Ele pode ter expirado, sido revogado ou atingido o limite de usos.",
  });

/** 8 caracteres Crockford base32. 256 é múltiplo de 32, então `byte % 32` não tem viés. */
export function generateShareCode(): string {
  return Array.from(randomBytes(8), (b) => SHARE_CODE_ALPHABET[b % 32]).join("");
}

type Payload =
  | { kind: "semester"; data: SemesterTemplatePayload }
  | { kind: "subject"; data: SubjectTemplatePayload };

/** O payload guardado é revalidado sempre: um modelo antigo ou corrompido nunca vira dado do aluno. */
function parsePayload(kind: string, version: number, raw: unknown): Payload | null {
  if (version !== 1) return null;
  if (kind === "semester") {
    const r = semesterTemplatePayloadSchema.safeParse(raw);
    return r.success ? { kind, data: r.data } : null;
  }
  if (kind === "subject") {
    const r = subjectTemplatePayloadSchema.safeParse(raw);
    return r.success ? { kind, data: r.data } : null;
  }
  return null;
}

@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    private readonly db: DbService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: ClockService,
  ) {}

  // ---------------------------------------------------------------- criar, listar, revogar

  create(userId: string, body: CreateTemplateBody): Promise<SharedTemplate> {
    return this.db.tx(async (tx) => {
      const now = this.clock.now();
      const [active] = await tx
        .select({ n: count() })
        .from(sharedTemplates)
        .where(
          and(
            isNull(sharedTemplates.revokedAt),
            or(isNull(sharedTemplates.expiresAt), gt(sharedTemplates.expiresAt, now)),
          ),
        );
      if ((active?.n ?? 0) >= MAX_ACTIVE_TEMPLATES) {
        throw new ConflictException({
          code: SharingErrorCode.limit,
          detail: `Você já tem ${MAX_ACTIVE_TEMPLATES} códigos ativos. Revogue algum para criar outro.`,
        });
      }

      const { payload, defaultTitle } =
        body.source.kind === "semester"
          ? await this.semesterPayload(tx, body.source.semesterId)
          : await this.subjectPayload(tx, body.source.subjectId);

      const expiresAt = new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000);
      // Colisão de código é rara (32^8 ≈ 1 trilhão); se acontecer, tenta outro dentro de um savepoint.
      for (let attempt = 0; ; attempt++) {
        try {
          const [row] = await tx.transaction(async (sp) =>
            sp
              .insert(sharedTemplates)
              .values({
                ownerId: userId,
                kind: body.source.kind,
                code: generateShareCode(),
                title: body.title ?? defaultTitle,
                institution: body.institution ?? null,
                course: body.course ?? null,
                payload,
                payloadVersion: 1,
                expiresAt,
                maxUses: body.maxUses,
              })
              .returning(),
          );
          return toSharedTemplate(row!, now);
        } catch (error) {
          if (attempt < 4 && isUniqueViolation(error, "shared_templates_code_key")) continue;
          throw error;
        }
      }
    });
  }

  private async semesterPayload(tx: Tx, semesterId: string) {
    const [semester] = await tx.select().from(semesters).where(eq(semesters.id, semesterId));
    if (!semester) throw new NotFoundException({ detail: "Semestre não encontrado." });
    const subjectRows = await tx
      .select()
      .from(subjects)
      .where(and(eq(subjects.semesterId, semesterId), isNull(subjects.archivedAt)))
      .orderBy(subjects.name);
    if (subjectRows.length === 0) {
      throw new UnprocessableEntityException({
        code: SharingErrorCode.empty,
        detail: "Adicione pelo menos uma matéria antes de compartilhar o semestre.",
      });
    }
    const ids = subjectRows.map((s) => s.id);
    const [schedules, exceptions] = await inOrder([
      tx.select().from(subjectSchedules).where(inArray(subjectSchedules.subjectId, ids)),
      tx.select().from(calendarExceptions).where(eq(calendarExceptions.semesterId, semesterId)),
    ]);
    const index = new Map(ids.map((id, i) => [id, i]));
    const payload: SemesterTemplatePayload = semesterTemplatePayloadSchema.parse({
      semester: { label: semester.label, startsOn: semester.startsOn, endsOn: semester.endsOn },
      subjects: subjectRows.map((s) =>
        subjectToTemplate(
          s,
          schedules.filter((x) => x.subjectId === s.id),
        ),
      ),
      exceptions: exceptions
        // Exceção de matéria arquivada (fora do modelo) não vai junto.
        .filter((e) => e.subjectId === null || index.has(e.subjectId))
        .map((e) => ({
          startsOn: e.startsOn,
          endsOn: e.endsOn,
          kind: e.kind,
          label: e.label,
          subjectIndex: e.subjectId === null ? null : index.get(e.subjectId)!,
        })),
    });
    return { payload, defaultTitle: semester.label };
  }

  private async subjectPayload(tx: Tx, subjectId: string) {
    const [subject] = await tx.select().from(subjects).where(eq(subjects.id, subjectId));
    if (!subject) throw new NotFoundException({ detail: "Matéria não encontrada." });
    const schedules = await tx
      .select()
      .from(subjectSchedules)
      .where(eq(subjectSchedules.subjectId, subjectId));
    const payload: SubjectTemplatePayload = { subject: subjectToTemplate(subject, schedules) };
    return { payload, defaultTitle: subject.name };
  }

  list(): Promise<SharedTemplate[]> {
    return this.db.tx(async (tx) => {
      const now = this.clock.now();
      const rows = await tx.select().from(sharedTemplates).orderBy(desc(sharedTemplates.createdAt));
      return rows.map((r) => toSharedTemplate(r, now));
    });
  }

  /** Revogar é idempotente. Quem já importou continua com a cópia (ela é dele). */
  revoke(id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .select({ id: sharedTemplates.id, revokedAt: sharedTemplates.revokedAt })
        .from(sharedTemplates)
        .where(eq(sharedTemplates.id, id));
      if (!row) throw new NotFoundException({ detail: "Código não encontrado." });
      if (!row.revokedAt) {
        await tx
          .update(sharedTemplates)
          .set({ revokedAt: sql`now()` })
          .where(eq(sharedTemplates.id, id));
      }
    });
  }

  // ---------------------------------------------------------------- prévia (pública)

  async preview(code: string): Promise<TemplatePreview> {
    const { rows } = await this.db.unscoped.execute<{
      kind: string;
      title: string;
      institution: string | null;
      course: string | null;
      payload: unknown;
      payload_version: number;
      uses_count: number;
      expires_at: Date | string | null;
    }>(sql`select * from app.share_preview(${code})`);
    const row = rows[0];
    if (!row) throw notFound();
    const payload = parsePayload(row.kind, row.payload_version, row.payload);
    if (!payload) {
      this.logger.warn(`modelo ${code} com payload inválido; tratado como inexistente`);
      throw notFound();
    }
    return toPreview(
      {
        code,
        kind: payload.kind,
        title: row.title,
        institution: row.institution,
        course: row.course,
        usesCount: row.uses_count,
        expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
      },
      payload.data,
    );
  }

  // ---------------------------------------------------------------- importar

  import(
    userId: string,
    code: string,
    body: ImportTemplateBody,
    key: string,
  ): Promise<IdempotentResult<ImportTemplateResult>> {
    return this.db.tx((tx) =>
      this.idempotency.run(tx, key, { code, ...body }, async () => ({
        status: 201,
        body: await this.importInTx(tx, userId, code, body),
      })),
    );
  }

  private async importInTx(
    tx: Tx,
    userId: string,
    code: string,
    body: ImportTemplateBody,
  ): Promise<ImportTemplateResult> {
    // Gasta um uso já na primeira linha. Tudo roda numa transação só: se qualquer passo abaixo
    // falhar (semestre de destino errado, dado inválido), o uso volta e nada fica pela metade.
    const consumed = await tx.execute<{
      template_id: string;
      kind: string;
      title: string;
      payload: unknown;
      payload_version: number;
    }>(sql`select * from app.share_consume(${code})`);
    const template = consumed.rows[0];
    if (!template) throw notFound();
    const payload = parsePayload(template.kind, template.payload_version, template.payload);
    if (!payload) {
      throw new UnprocessableEntityException({
        code: SharingErrorCode.invalidPayload,
        detail: "Este modelo foi criado numa versão antiga do app e não pode ser importado.",
      });
    }

    if (payload.kind === "subject") {
      if (!body.semesterId) {
        throw new UnprocessableEntityException({
          code: SharingErrorCode.semesterRequired,
          errors: [{ path: "semesterId", message: "Escolha em qual semestre a matéria entra." }],
        });
      }
      const [semester] = await tx
        .select({ id: semesters.id })
        .from(semesters)
        .where(eq(semesters.id, body.semesterId));
      if (!semester) throw new NotFoundException({ detail: "Semestre não encontrado." });
      const subjectId = await this.insertSubject(
        tx,
        semester.id,
        payload.data.subject,
        template.template_id,
      );
      await tx.insert(templateImports).values({ templateId: template.template_id, userId });
      return { semesterId: semester.id, subjectIds: [subjectId], createdSemester: false };
    }

    const data = payload.data;
    const label = await this.freeLabel(tx, body.label ?? data.semester.label);
    const [hasCurrent] = await tx
      .select({ id: semesters.id })
      .from(semesters)
      .where(eq(semesters.isCurrent, true))
      .limit(1);
    const [semester] = await tx
      .insert(semesters)
      .values({
        userId,
        label,
        startsOn: data.semester.startsOn,
        endsOn: data.semester.endsOn,
        // Primeiro semestre do aluno já vira o atual; senão ele escolhe depois.
        isCurrent: !hasCurrent,
      })
      .returning({ id: semesters.id });
    const subjectIds: string[] = [];
    for (const s of data.subjects) {
      subjectIds.push(await this.insertSubject(tx, semester!.id, s, template.template_id));
    }
    if (data.exceptions.length > 0) {
      await tx.insert(calendarExceptions).values(
        data.exceptions
          .filter((e) => e.subjectIndex === null || e.subjectIndex < subjectIds.length)
          .map((e) => ({
            userId,
            semesterId: semester!.id,
            startsOn: e.startsOn,
            endsOn: e.endsOn,
            kind: e.kind,
            label: e.label,
            subjectId: e.subjectIndex === null ? null : subjectIds[e.subjectIndex]!,
          })),
      );
    }
    await tx
      .insert(templateImports)
      .values({ templateId: template.template_id, userId, createdSemesterId: semester!.id });
    return { semesterId: semester!.id, subjectIds, createdSemester: true };
  }

  private async insertSubject(
    tx: Tx,
    semesterId: string,
    s: TemplateSubject,
    templateId: string,
  ): Promise<string> {
    const [row] = await tx
      .insert(subjects)
      .values({
        ...subjectColumns(s),
        userId: sql`app.current_user_id()`,
        semesterId,
        sourceTemplateId: templateId,
      })
      .returning({ id: subjects.id });
    if (s.schedules.length > 0) {
      await tx.insert(subjectSchedules).values(
        s.schedules.map((x) => ({
          ...scheduleColumns(x),
          userId: sql`app.current_user_id()`,
          subjectId: row!.id,
        })),
      );
    }
    return row!.id;
  }

  /** "2026.2" já existe → "2026.2 (2)", "2026.2 (3)"… (o nome é único por aluno). */
  private async freeLabel(tx: Tx, wanted: string): Promise<string> {
    const rows = await tx.select({ label: semesters.label }).from(semesters);
    const taken = new Set(rows.map((r) => r.label));
    if (!taken.has(wanted)) return wanted;
    for (let n = 2; ; n++) {
      const suffix = ` (${n})`;
      const candidate = `${wanted.slice(0, 60 - suffix.length)}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
