import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { routes } from "@presenca/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DB } from "../database/tokens";
import { REDIS } from "../redis/redis.module";
import { HealthController } from "../health/health.controller";
import { buildTestApp } from "../test/build-test-app";
import { OpenApiController } from "./openapi.controller";

const INFRA_ROUTES = new Set(["GET /openapi.json"]);

const CONTROLLERS = [HealthController, OpenApiController];
const PROVIDERS = [
  { provide: DB, useValue: { ping: async () => 1 } },
  { provide: REDIS, useValue: { ping: async () => "PONG" } },
];

describe("OpenAPI", () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("publica um documento 3.1 com todas as rotas do contrato", async () => {
    app = await buildTestApp({ controllers: CONTROLLERS, providers: PROVIDERS });
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; paths: Record<string, Record<string, unknown>> }>();
    expect(doc.openapi).toBe("3.1.0");
    for (const route of Object.values(routes)) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      expect(
        doc.paths[path]?.[route.method.toLowerCase()],
        `${route.method} ${path}`,
      ).toBeDefined();
    }
  });

  it("fica desligado quando OPENAPI_ENABLED=false", async () => {
    app = await buildTestApp({
      controllers: CONTROLLERS,
      providers: PROVIDERS,
      env: { OPENAPI_ENABLED: "false" },
    });
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(404);
  });

  it("toda rota registrada na API está no contrato, e vice-versa", async () => {
    const registered = new Set<string>();
    app = await buildTestApp({
      fullApp: true,
      beforeInit: (fastify) => {
        fastify.addHook("onRoute", (route) => {
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          for (const m of methods)
            if (m !== "HEAD" && m !== "OPTIONS") registered.add(`${m} ${route.url}`);
        });
      },
    });
    const declared = new Set(Object.values(routes).map((r) => `${r.method} ${r.path}`));
    const missingFromContract = [...registered].filter(
      (r) => !declared.has(r) && !INFRA_ROUTES.has(r),
    );
    const missingFromApi = [...declared].filter((r) => !registered.has(r));
    expect(missingFromContract).toEqual([]);
    expect(missingFromApi).toEqual([]);
  });
});
