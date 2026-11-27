import "reflect-metadata";
import type { DynamicModule, Provider, Type } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AppModule } from "../app.module";
import { configureApp, createFastifyAdapter } from "../common/http";
import { createLogger } from "../common/logger";
import { ConfigModule } from "../config/config.module";
import { type Env, loadEnv } from "../config/env";

export const TEST_ORIGIN = "http://localhost:3000";

interface Options {
  fullApp?: boolean;
  controllers?: Type[];
  providers?: Provider[];
  env?: Record<string, string>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  beforeInit?: (fastify: FastifyInstance) => void;
}

export function testEnv(extra: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: "postgres://teste:teste@127.0.0.1:1/teste",
    REDIS_URL: "redis://127.0.0.1:1",
    ...extra,
  });
}

export async function buildTestApp(options: Options = {}): Promise<NestFastifyApplication> {
  const env = testEnv(options.env);
  const logger = createLogger(env);
  const imports: DynamicModule[] = options.fullApp
    ? [AppModule.forRoot(env)]
    : [ConfigModule.forRoot(env)];
  let builder = Test.createTestingModule({
    imports,
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  });
  if (options.override) builder = options.override(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(env, logger),
    { logger: false },
  );
  const fastify = app.getHttpAdapter().getInstance();
  options.beforeInit?.(fastify);
  await configureApp(app, env, logger);
  await app.init();
  await fastify.ready();
  return app;
}
