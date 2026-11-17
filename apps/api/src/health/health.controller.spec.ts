import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { healthResponseSchema, readinessResponseSchema } from "@presenca/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DB } from "../database/database.module";
import { HealthController } from "./health.controller";

async function buildApp(ping: () => Promise<number>): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DB, useValue: { ping } }],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("HealthController", () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("GET /healthz responde 200 no formato do contrato", async () => {
    app = await buildApp(async () => 1);
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json()).service).toBe("api");
  });

  it("GET /readyz responde 200 quando o banco responde", async () => {
    app = await buildApp(async () => 3);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(readinessResponseSchema.parse(res.json()).checks.database?.status).toBe("up");
  });

  it("GET /readyz responde 503 quando o banco está fora", async () => {
    app = await buildApp(async () => {
      throw new Error("connection refused");
    });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: "not_ready",
      checks: { database: { status: "down" } },
    });
  });
});
