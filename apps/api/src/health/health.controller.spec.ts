import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { healthResponseSchema, readinessResponseSchema } from "@presenca/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DB } from "../database/database.module";
import { buildTestApp } from "../test/build-test-app";
import { HealthController } from "./health.controller";

const build = (ping: () => Promise<number>) =>
  buildTestApp({
    controllers: [HealthController],
    providers: [{ provide: DB, useValue: { ping } }],
    env: { APP_VERSION: "1.2.3" },
  });

describe("HealthController", () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("GET /healthz responde 200 no formato do contrato, com a versão do ambiente", async () => {
    app = await build(async () => 1);
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toMatchObject({
      service: "api",
      version: "1.2.3",
    });
  });

  it("GET /readyz responde 200 quando o banco responde", async () => {
    app = await build(async () => 3);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(readinessResponseSchema.parse(res.json()).checks.database?.status).toBe("up");
  });

  it("GET /readyz responde 503 quando o banco está fora", async () => {
    app = await build(async () => {
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
