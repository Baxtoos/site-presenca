import { z } from "zod";
import { exceptionKindSchema, subjectColorSchema } from "./academic";
import { taskSchema, taskStatusSchema } from "./tasks";

/** Maior intervalo do calendário/linha do tempo (o mesmo do calendário de aulas). */
export const CALENDAR_RANGE_MAX_DAYS = 400;

const dateSchema = z.iso.date({ error: "Use a data no formato AAAA-MM-DD." });

export const calendarQuerySchema = z
  .object({
    /** Primeiro dia (inclusive), no fuso da conta. */
    from: dateSchema,
    /** Último dia (inclusive), no fuso da conta. */
    to: dateSchema,
    subjectId: z.uuid({ error: "Matéria inválida." }).optional(),
    /** Filtra só as tarefas; exceções e chamadas pendentes vêm sempre. */
    status: taskStatusSchema.optional(),
    /** true: inclui as aulas da grade de cada dia (o calendário mensal pede; a linha do tempo não). */
    classes: z.stringbool().default(false),
  })
  .superRefine((q, ctx) => {
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (days < 0) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "A data final vem antes da inicial." });
    } else if (days >= CALENDAR_RANGE_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Use um intervalo de até ${CALENDAR_RANGE_MAX_DAYS} dias.`,
      });
    }
  });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarDayExceptionSchema = z.object({
  kind: exceptionKindSchema,
  label: z.string(),
  semesterLabel: z.string(),
  /** null = vale para todas as matérias do semestre. */
  subjectName: z.string().nullable(),
});
export type CalendarDayException = z.infer<typeof calendarDayExceptionSchema>;

export const calendarDayClassSchema = z.object({
  subjectId: z.uuid(),
  subjectName: z.string(),
  color: subjectColorSchema.nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  units: z.number().int(),
  /** done = chamada registrada; pending = já passou sem registro; upcoming = hoje ou depois. */
  state: z.enum(["done", "pending", "upcoming"]),
});
export type CalendarDayClass = z.infer<typeof calendarDayClassSchema>;

export const calendarDaySchema = z.object({
  date: z.iso.date(),
  /** Tarefas cujo prazo cai neste dia no fuso do aluno, por horário. */
  tasks: z.array(taskSchema),
  exceptions: z.array(calendarDayExceptionSchema),
  /** Aulas da grade (só com `classes=true`), por horário. Dia de feriado/sem aula não tem aulas. */
  classes: z.array(calendarDayClassSchema),
  /** Dias que já passaram: aulas da grade sem chamada registrada. */
  pendingClasses: z.number().int().min(0),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;

export const calendarResponseSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Hoje no fuso da conta. */
  today: z.iso.date(),
  timezone: z.string(),
  /** Pendentes com o prazo já passado (fora ou dentro do intervalo), para o alerta. */
  overdueCount: z.number().int().min(0),
  /** Só os dias com alguma coisa, em ordem. */
  days: z.array(calendarDaySchema),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
