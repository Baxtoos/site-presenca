import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { MoodleGradesController } from "./moodle-grades.controller";
import { MoodleController } from "./moodle.controller";
import { MoodleService } from "./moodle.service";

@Module({
  controllers: [MoodleController, MoodleGradesController],
  providers: [MoodleService, IdempotencyService, ClockService],
})
export class MoodleModule {}
