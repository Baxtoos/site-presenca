import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

// Em desenvolvimento lê o .env da raiz do monorepo; em produção as variáveis vêm do ambiente.
if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(resolve(__dirname, "../../../.env"));
  } catch {
    // sem .env: segue com o ambiente atual e deixa a validação apontar o que falta
  }
}

async function bootstrap(): Promise<void> {
  // Valida antes de criar o app: o adaptador HTTP também depende do ambiente (trustProxy).
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 64 * 1024, trustProxy: env.TRUST_PROXY }),
  );
  app.enableShutdownHooks();
  await app.listen(env.API_PORT, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
