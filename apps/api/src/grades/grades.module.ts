import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { ENV, type Env } from "../config/env";
import { GRADING_AI, GradingAssistantService, gradingAiFactory } from "./assistant.service";
import { GradesController } from "./grades.controller";
import { GradesService } from "./grades.service";

/** Notas e regra de cálculo por matéria (conta feita pelo motor em packages/engine/src/grades). */
@Module({
  controllers: [GradesController],
  providers: [
    GradesService,
    GradingAssistantService,
    ClockService,
    {
      provide: GRADING_AI,
      useFactory: (env: Env) => gradingAiFactory(env),
      inject: [ENV],
    },
  ],
  exports: [GradesService],
})
export class GradesModule {}
