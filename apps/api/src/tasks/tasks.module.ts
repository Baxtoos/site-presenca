import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { TaskCalendarController } from "./calendar.controller";
import { TaskCalendarService } from "./calendar.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  controllers: [TasksController, TaskCalendarController],
  providers: [TasksService, TaskCalendarService, IdempotencyService, ClockService],
})
export class TasksModule {}
