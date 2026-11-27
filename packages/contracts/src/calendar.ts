import { z } from "zod";
import { exceptionKindSchema, subjectColorSchema } from "./academic";
import { taskSchema, taskStatusSchema } from "./tasks";

export const CALENDAR_RANGE_MAX_DAYS = 400;

const dateSchema = z.iso.date({ error: "Use a data no formato AAAA-MM-DD." });

export const calendarQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    subjectId: z.uuid({ error: "Matéria inválida." }).optional(),
    status: taskStatusSchema.optional(),
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
  state: z.enum(["done", "pending", "upcoming"]),
});
export type CalendarDayClass = z.infer<typeof calendarDayClassSchema>;

export const calendarDaySchema = z.object({
  date: z.iso.date(),
  tasks: z.array(taskSchema),
  exceptions: z.array(calendarDayExceptionSchema),
  classes: z.array(calendarDayClassSchema),
  pendingClasses: z.number().int().min(0),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;

export const calendarResponseSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  today: z.iso.date(),
  timezone: z.string(),
  overdueCount: z.number().int().min(0),
  days: z.array(calendarDaySchema),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
