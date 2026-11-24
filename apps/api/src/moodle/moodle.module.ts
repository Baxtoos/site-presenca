import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { MoodleController } from "./moodle.controller";
import { MoodleService } from "./moodle.service";

/** Conector do Moodle (a sincronização periódica fica no worker: apps/worker/src/moodle-sync.ts). */
@Module({
  controllers: [MoodleController],
  providers: [MoodleService, IdempotencyService, ClockService],
})
export class MoodleModule {}
