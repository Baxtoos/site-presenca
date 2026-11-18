import { type DynamicModule, Module } from "@nestjs/common";
import { AcademicModule } from "./academic/academic.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import type { Env } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { MailModule } from "./mail/mail.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OpenApiController } from "./openapi/openapi.controller";
import { RedisModule } from "./redis/redis.module";

@Module({})
export class AppModule {
  /** Recebe o ambiente já validado pelo bootstrap (validado uma única vez). */
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        DatabaseModule,
        RedisModule,
        MailModule,
        AuthModule,
        AcademicModule,
        AttendanceModule,
        NotificationsModule,
      ],
      controllers: [HealthController, OpenApiController],
    };
  }
}
