import { Controller, Get, Query } from "@nestjs/common";
import {
  type CalendarQuery,
  calendarQuerySchema,
  type CalendarResponse,
} from "@presenca/contracts";
import { ZodPipe } from "../common/zod.pipe";
import { TaskCalendarService } from "./calendar.service";

/** Linha do tempo e calendário mensal do aluno logado (tarefas, exceções e chamadas pendentes). */
@Controller("v1/calendar")
export class TaskCalendarController {
  constructor(private readonly calendar: TaskCalendarService) {}

  @Get()
  get(@Query(new ZodPipe(calendarQuerySchema)) query: CalendarQuery): Promise<CalendarResponse> {
    return this.calendar.get(query);
  }
}
