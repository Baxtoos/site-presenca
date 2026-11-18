import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  AcademicErrorCode,
  type CreateSemesterBody,
  type Semester,
  type UpdateSemesterBody,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { isUniqueViolation } from "../auth/user-mapper";
import { assertVersioned } from "../common/versioning";
import { DbService } from "../database/db.service";
import { toSemester } from "./mappers";

const { semesters, subjects } = schema;

const labelTaken = () =>
  new ConflictException({
    code: AcademicErrorCode.semesterLabelTaken,
    detail: "Você já tem um semestre com esse nome.",
  });

@Injectable()
export class SemestersService {
  constructor(private readonly db: DbService) {}

  list(): Promise<Semester[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({ semester: semesters, subjectsCount: count(subjects.id) })
        .from(semesters)
        .leftJoin(subjects, eq(subjects.semesterId, semesters.id))
        .groupBy(semesters.id)
        .orderBy(desc(semesters.isCurrent), desc(semesters.startsOn));
      return rows.map((r) => toSemester(r.semester, r.subjectsCount));
    });
  }

  get(id: string): Promise<Semester> {
    return this.db.tx((tx) => this.load(tx, id));
  }

  async create(body: CreateSemesterBody): Promise<Semester> {
    try {
      return await this.db.tx(async (tx) => {
        if (body.isCurrent) await this.unsetCurrent(tx);
        const [row] = await tx
          .insert(semesters)
          .values({
            userId: sql`app.current_user_id()`,
            label: body.label,
            startsOn: body.startsOn,
            endsOn: body.endsOn,
            isCurrent: body.isCurrent,
          })
          .returning();
        return toSemester(row!, 0);
      });
    } catch (error) {
      if (isUniqueViolation(error, "semesters_user_label_key")) throw labelTaken();
      throw error;
    }
  }

  async update(id: string, expectedVersion: number, body: UpdateSemesterBody): Promise<Semester> {
    try {
      return await this.db.tx(async (tx) => {
        const current = await this.load(tx, id);
        const startsOn = body.startsOn ?? current.startsOn;
        const endsOn = body.endsOn ?? current.endsOn;
        if (endsOn <= startsOn) {
          throw new UnprocessableEntityException({
            errors: [{ path: "endsOn", message: "O fim precisa ser depois do início." }],
          });
        }

        // Arquivado não pode ser o atual; marcar como atual desarquiva.
        const patch: Partial<typeof semesters.$inferInsert> = { ...body };
        if (body.status === "archived") patch.isCurrent = false;
        if (body.isCurrent === true) {
          patch.status = "active";
          await this.unsetCurrent(tx, id);
        }

        const rows = await tx
          .update(semesters)
          .set(patch)
          .where(and(eq(semesters.id, id), eq(semesters.version, expectedVersion)))
          .returning();
        const row = await assertVersioned(rows, async () => true);
        return toSemester(row, current.subjectsCount);
      });
    } catch (error) {
      if (isUniqueViolation(error, "semesters_user_label_key")) throw labelTaken();
      throw error;
    }
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    await this.db.tx(async (tx) => {
      const rows = await tx
        .delete(semesters)
        .where(and(eq(semesters.id, id), eq(semesters.version, expectedVersion)))
        .returning({ id: semesters.id });
      await assertVersioned(rows, () => this.exists(tx, id), "Semestre não encontrado.");
    });
  }

  /** Carrega o semestre (o RLS já restringe ao dono; de outra pessoa vira 404). */
  async load(tx: Tx, id: string): Promise<Semester> {
    const [row] = await tx
      .select({ semester: semesters, subjectsCount: count(subjects.id) })
      .from(semesters)
      .leftJoin(subjects, eq(subjects.semesterId, semesters.id))
      .where(eq(semesters.id, id))
      .groupBy(semesters.id);
    if (!row) throw new NotFoundException({ detail: "Semestre não encontrado." });
    return toSemester(row.semester, row.subjectsCount);
  }

  private async exists(tx: Tx, id: string): Promise<boolean> {
    const [row] = await tx.select({ id: semesters.id }).from(semesters).where(eq(semesters.id, id));
    return row !== undefined;
  }

  /** Só um semestre atual por aluno (índice único parcial): desmarca os outros antes. */
  private async unsetCurrent(tx: Tx, exceptId?: string): Promise<void> {
    await tx
      .update(semesters)
      .set({ isCurrent: false })
      .where(
        exceptId
          ? and(eq(semesters.isCurrent, true), ne(semesters.id, exceptId))
          : eq(semesters.isCurrent, true),
      );
  }
}
