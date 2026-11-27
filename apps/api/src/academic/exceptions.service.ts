import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import {
  AcademicErrorCode,
  type CalendarExceptionDto,
  type ExceptionBody,
} from "@presenca/contracts";
import { schema } from "@presenca/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { DbService } from "../database/db.service";
import { toException } from "./mappers";
import { SemestersService } from "./semesters.service";

const { calendarExceptions, subjects } = schema;

const brDate = (iso: string) => iso.split("-").reverse().join("/");

@Injectable()
export class ExceptionsService {
  constructor(
    private readonly db: DbService,
    private readonly semesters: SemestersService,
  ) {}

  list(semesterId: string): Promise<CalendarExceptionDto[]> {
    return this.db.tx(async (tx) => {
      await this.semesters.load(tx, semesterId);
      const rows = await tx
        .select()
        .from(calendarExceptions)
        .where(eq(calendarExceptions.semesterId, semesterId))
        .orderBy(asc(calendarExceptions.startsOn));
      return rows.map(toException);
    });
  }

  create(semesterId: string, body: ExceptionBody): Promise<CalendarExceptionDto> {
    return this.db.tx(async (tx) => {
      const semester = await this.semesters.load(tx, semesterId);
      const startOutside = body.startsOn < semester.startsOn || body.startsOn > semester.endsOn;
      if (startOutside || body.endsOn > semester.endsOn) {
        throw new UnprocessableEntityException({
          code: AcademicErrorCode.outOfSemester,
          errors: [
            {
              path: startOutside ? "startsOn" : "endsOn",
              message: `Fica fora do semestre (${brDate(semester.startsOn)} a ${brDate(semester.endsOn)}).`,
            },
          ],
        });
      }
      if (body.subjectId) {
        const [subject] = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(eq(subjects.id, body.subjectId), eq(subjects.semesterId, semesterId)));
        if (!subject) {
          throw new UnprocessableEntityException({
            code: AcademicErrorCode.subjectNotInSemester,
            errors: [{ path: "subjectId", message: "Esta matéria não é deste semestre." }],
          });
        }
      }
      const [row] = await tx
        .insert(calendarExceptions)
        .values({
          userId: sql`app.current_user_id()`,
          semesterId,
          startsOn: body.startsOn,
          endsOn: body.endsOn,
          kind: body.kind,
          label: body.label,
          subjectId: body.subjectId ?? null,
        })
        .returning();
      return toException(row!);
    });
  }

  async remove(semesterId: string, exceptionId: string): Promise<void> {
    const rows = await this.db.tx((tx) =>
      tx
        .delete(calendarExceptions)
        .where(
          and(
            eq(calendarExceptions.id, exceptionId),
            eq(calendarExceptions.semesterId, semesterId),
          ),
        )
        .returning({ id: calendarExceptions.id }),
    );
    if (rows.length === 0) throw new NotFoundException({ detail: "Exceção não encontrada." });
  }
}
