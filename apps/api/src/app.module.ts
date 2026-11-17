import { type DynamicModule, Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import type { Env } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { OpenApiController } from "./openapi/openapi.controller";

@Module({})
export class AppModule {
  /** Recebe o ambiente já validado pelo bootstrap (validado uma única vez). */
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), DatabaseModule],
      controllers: [HealthController, OpenApiController],
    };
  }
}
