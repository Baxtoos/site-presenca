import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

/** Tarefas e entregas. Os avisos de prazo são gerados pelo worker (apps/worker/src/task-reminders.ts). */
@Module({
  controllers: [TasksController],
  providers: [TasksService, IdempotencyService, ClockService],
})
export class TasksModule {}
