import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { SharingController } from "./sharing.controller";
import { SharingService } from "./sharing.service";

/** Compartilhamento de grades: códigos, prévia pública e importação. */
@Module({
  controllers: [SharingController],
  providers: [SharingService, IdempotencyService, ClockService],
})
export class SharingModule {}
