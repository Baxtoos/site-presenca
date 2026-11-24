import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { TaskCalendarController } from "./calendar.controller";
import { TaskCalendarService } from "./calendar.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

/** Tarefas e entregas. Os avisos de prazo são gerados pelo worker (apps/worker/src/task-reminders.ts). */
@Module({
  controllers: [TasksController, TaskCalendarController],
  providers: [TasksService, TaskCalendarService, IdempotencyService, ClockService],
})
export class TasksModule {}
