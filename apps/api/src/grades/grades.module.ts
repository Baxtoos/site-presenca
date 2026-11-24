import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { GradesController } from "./grades.controller";
import { GradesService } from "./grades.service";

/** Notas e regra de cálculo por matéria (conta feita pelo motor em packages/engine/src/grades). */
@Module({
  controllers: [GradesController],
  providers: [GradesService, ClockService],
  exports: [GradesService],
})
export class GradesModule {}
