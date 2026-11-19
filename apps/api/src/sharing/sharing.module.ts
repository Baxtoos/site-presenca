import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { NotificationsModule } from "../notifications/notifications.module";
import { SharingController } from "./sharing.controller";
import { SharingService } from "./sharing.service";
import { SpreadsheetImportController } from "./spreadsheet-import.controller";
import { SpreadsheetImportService } from "./spreadsheet-import.service";

/** Compartilhamento de grades (códigos, prévia pública e importação) e importação de planilha. */
@Module({
  imports: [NotificationsModule],
  controllers: [SharingController, SpreadsheetImportController],
  providers: [SharingService, SpreadsheetImportService, IdempotencyService, ClockService],
})
export class SharingModule {}
