import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { ThresholdAlerts } from "./threshold-alerts";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ThresholdAlerts],
  exports: [ThresholdAlerts],
})
export class NotificationsModule {}
