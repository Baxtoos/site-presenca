import { Module } from "@nestjs/common";
import { ClockService } from "../common/clock";
import { IdempotencyService } from "../common/idempotency";
import { NotificationsModule } from "../notifications/notifications.module";
import { SharingController } from "./sharing.controller";
import { SharingService } from "./sharing.service";
import { SpreadsheetImportController } from "./spreadsheet-import.controller";
import { SpreadsheetImportService } from "./spreadsheet-import.service";
import { SuapSyncController } from "./suap-sync.controller";
import { SuapSyncService } from "./suap-sync.service";

/**
 * Compartilhamento de grades (códigos, prévia pública e importação), importação de planilha e
 * sincronização com o SUAP.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [SharingController, SpreadsheetImportController, SuapSyncController],
  providers: [
    SharingService,
    SpreadsheetImportService,
    SuapSyncService,
    IdempotencyService,
    ClockService,
  ],
})
export class SharingModule {}
