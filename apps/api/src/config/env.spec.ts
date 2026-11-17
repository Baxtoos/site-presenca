import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://app_api:x@localhost:5432/presenca",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadEnv da API", () => {
  it("aplica padrões seguros", () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it.each([
    ["1", 1],
    ["10.0.0.0/8, 127.0.0.1", ["10.0.0.0/8", "127.0.0.1"]],
    ["false", false],
  ])("TRUST_PROXY=%s vira %o", (raw, expected) => {
    expect(loadEnv({ ...base, TRUST_PROXY: raw }).TRUST_PROXY).toEqual(expected);
  });

  it("recusa TRUST_PROXY=true em produção", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", TRUST_PROXY: "true" })).toThrow(
      /TRUST_PROXY/,
    );
  });

  it("lista todas as variáveis faltando de uma vez", () => {
    expect(() => loadEnv({})).toThrow(/WEB_ORIGIN[\s\S]*DATABASE_URL[\s\S]*REDIS_URL/);
  });
});
