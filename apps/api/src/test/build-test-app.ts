import "reflect-metadata";
import type { Provider, Type } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { configureApp, createFastifyAdapter } from "../common/http";
import { createLogger } from "../common/logger";
import { ConfigModule } from "../config/config.module";
import { loadEnv } from "../config/env";

export const TEST_ORIGIN = "http://localhost:3000";

interface Options {
  controllers?: Type[];
  providers?: Provider[];
  env?: Record<string, string>;
  /** Roda antes do init (ex.: registrar hooks que precisam ver as rotas sendo criadas). */
  beforeInit?: (fastify: FastifyInstance) => void;
}

/** Monta a API com a mesma configuração HTTP da produção (configureApp), sem banco real. */
export async function buildTestApp(options: Options = {}): Promise<NestFastifyApplication> {
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: "postgres://teste:teste@127.0.0.1:1/teste",
    REDIS_URL: "redis://127.0.0.1:1",
    ...options.env,
  });
  const logger = createLogger(env);
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(env)],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  }).compile();

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
