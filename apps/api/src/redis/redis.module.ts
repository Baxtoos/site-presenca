import { Global, Inject, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV, type Env } from "../config/env";

export const REDIS = Symbol("REDIS");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        const client = new Redis(env.REDIS_URL, {
          connectionName: "presenca-api",
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          commandTimeout: 1_000,
          retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
        });
        const logger = new Logger("Redis");
        let lastLog = 0;
        client.on("error", (error: Error) => {
          if (Date.now() - lastLog < 30_000) return;
          lastLog = Date.now();
          logger.warn(`Redis indisponível: ${error.message || (error as { code?: string }).code}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
