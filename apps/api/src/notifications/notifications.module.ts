import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { ThresholdAlerts } from "./threshold-alerts";

/** Central de avisos, preferências, push e a avaliação de marcos usada por quem muda os números. */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ThresholdAlerts],
  exports: [ThresholdAlerts],
})
export class NotificationsModule {}
