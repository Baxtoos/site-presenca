import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
import { SimulateService } from "./simulate.service";
import { TodayService } from "./today.service";

/** Registro de presença, aulas de hoje, histórico e simulador. Tudo exige sessão (guard global). */
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, TodayService, SimulateService, IdempotencyService, ClockService],
})
export class AttendanceModule {}
