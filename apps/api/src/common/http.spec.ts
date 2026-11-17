import { Body, ConflictException, Controller, Get, Post } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { problemSchema } from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildTestApp, TEST_ORIGIN } from "../test/build-test-app";
import { requestContext } from "./request-context";
import { ZodPipe } from "./zod.pipe";

const echoSchema = z.object({ name: z.string().min(2), age: z.number().int() });

@Controller("__test")
class ProbeController {
  @Post("echo")
  echo(@Body(new ZodPipe(echoSchema)) body: z.output<typeof echoSchema>) {
    return body;
  }

  @Get("boom")
  boom() {
    throw new Error("segredo interno: senha do banco");
  }

  @Get("conflict")
  conflict() {
    throw new ConflictException({ code: "ATTENDANCE_CONFLICT", detail: "Já existe registro." });
  }

  @Get("context")
  async context() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { requestId: requestContext.get()?.requestId ?? null };
  }
}

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await buildTestApp({ controllers: [ProbeController] });
});
afterAll(async () => {
  await app.close();
});

const expectProblem = (
  res: { statusCode: number; headers: Record<string, unknown>; json: () => unknown },
  status: number,
  code: string,
) => {
  expect(res.statusCode).toBe(status);
  expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
  const body = problemSchema.parse(res.json());
  expect(body.code).toBe(code);
  expect(body.requestId).toBe(res.headers["x-request-id"]);
  return body;
};

describe("erros no formato problem+json", () => {
  it("rota inexistente → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/nao-existe" });
    expectProblem(res, 404, "NOT_FOUND");
  });

  it("erro inesperado → 500 sem vazar a mensagem interna", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/boom" });
    const body = expectProblem(res, 500, "INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("segredo");
  });

  it("erro de negócio mantém código e detalhe", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/conflict" });
    const body = expectProblem(res, 409, "ATTENDANCE_CONFLICT");
    expect(body.detail).toBe("Já existe registro.");
  });

  it("validação → 422 com o campo e a mensagem em português", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: "A", age: 1.5 },
    });
    const body = expectProblem(res, 422, "VALIDATION_FAILED");
    expect(body.errors?.map((e) => e.path).sort()).toEqual(["age", "name"]);
    expect(body.errors?.find((e) => e.path === "name")?.message).toMatch(/pequen|caracteres/i);
  });

  it("JSON malformado → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      headers: { "content-type": "application/json" },
      payload: '{"name": ',
    });
    expectProblem(res, 400, "BAD_REQUEST");
  });

  it("corpo acima de 64 KB → 413", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: "x".repeat(70 * 1024), age: 1 },
    });
    expectProblem(res, 413, "PAYLOAD_TOO_LARGE");
  });

  it("content-type não suportado → 415", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      headers: { "content-type": "application/xml" },
      payload: "<a/>",
    });
    expectProblem(res, 415, "UNSUPPORTED_MEDIA_TYPE");
  });

  it("dados válidos passam convertidos", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: "Ana", age: 20, extra: "ignorado" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ name: "Ana", age: 20 });
  });
});

describe("request id", () => {
  it("reaproveita um X-Request-Id seguro e o devolve", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test/context",
      headers: { "x-request-id": "proxy-abc-12345" },
    });
    expect(res.headers["x-request-id"]).toBe("proxy-abc-12345");
    expect(res.json()).toEqual({ requestId: "proxy-abc-12345" });
  });

  it("troca um X-Request-Id inseguro por um UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test/context",
      headers: { "x-request-id": "<script>alert(1)</script>" },
    });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("fica disponível no contexto assíncrono da requisição", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/context" });
    expect(res.json()).toEqual({ requestId: res.headers["x-request-id"] });
  });
});

describe("proteção contra CSRF (Origin)", () => {
  const post = (origin?: string) =>
    app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: "Ana", age: 20 },
      headers: origin ? { origin } : {},
    });

  it("recusa escrita vinda de outro site", async () => {
    expectProblem(await post("https://site-malicioso.exemplo"), 403, "ORIGIN_NOT_ALLOWED");
  });

  it("aceita escrita vinda do app", async () => {
    expect((await post(TEST_ORIGIN)).statusCode).toBe(201);
  });

  it("aceita chamadas sem Origin (servidor para servidor)", async () => {
    expect((await post()).statusCode).toBe(201);
  });

  it("leituras não dependem de Origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test/context",
      headers: { origin: "https://site-malicioso.exemplo" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("cabeçalhos de segurança", () => {
  it("envia nosniff, CSP fechada e nada de X-Powered-By", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/context" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
