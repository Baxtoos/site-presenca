import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type DbHandle } from "@presenca/db";
import { ENV, type Env } from "../config/env";
import { DbService } from "./db.service";
import { DB } from "./tokens";

export { DB } from "./tokens";

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): DbHandle =>
        createDb({ connectionString: env.DATABASE_URL, applicationName: "presenca-api" }),
    },
    DbService,
  ],
  exports: [DB, DbService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
