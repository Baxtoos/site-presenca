import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { NotificationsModule } from "../notifications/notifications.module";
import { IdempotencyService } from "../common/idempotency";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
import { CalendarService } from "./calendar.service";
import { EvolutionService } from "./evolution.service";
import { SimulateService } from "./simulate.service";
import { TodayService } from "./today.service";

@Module({
  imports: [NotificationsModule],
  controllers: [AttendanceController],
  providers: [
    EvolutionService,
    AttendanceService,
    TodayService,
    SimulateService,
    CalendarService,
    IdempotencyService,
    ClockService,
  ],
})
export class AttendanceModule {}
