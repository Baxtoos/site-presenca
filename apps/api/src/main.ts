import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { flushErrors, initErrorReporting, reportError } from "@presenca/observability";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { configureApp, createFastifyAdapter } from "./common/http";
import { createLogger, PinoNestLogger } from "./common/logger";
import { loadEnv } from "./config/env";

if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(resolve(__dirname, "../../../.env"));
  } catch {}
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);
  initErrorReporting({
    dsn: env.SENTRY_DSN,
    service: "api",
    environment: env.NODE_ENV,
    release: env.APP_VERSION,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    createFastifyAdapter(env, logger),
    { logger: new PinoNestLogger(logger) },
  );
  await configureApp(app, env, logger);
  await app.listen(env.API_PORT, "0.0.0.0");
}

bootstrap().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  reportError(error, { phase: "startup" });
  await flushErrors();
  process.exit(1);
});
