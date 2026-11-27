import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://app_api:x@localhost:5432/presenca",
  REDIS_URL: "redis://localhost:6379",
};

const production = {
  ...base,
  NODE_ENV: "production",
  WEB_ORIGIN: "https://app.exemplo",
  MAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_teste",
};

describe("loadEnv da API", () => {
  it("aplica padrões seguros", () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.MAIL_TRANSPORT).toBe("log");
  });

  it.each([
    [{}, "dev"],
    [{ RENDER_GIT_COMMIT: "5ca8eeaee74158386866bae152a54816a8c83500" }, "5ca8eea"],
    [{ APP_VERSION: "1.2.3", RENDER_GIT_COMMIT: "5ca8eeaee741" }, "1.2.3"],
    [{ APP_VERSION: "", RENDER_GIT_COMMIT: "abcdef1234567" }, "abcdef1"],
  ])("versão publicada com %o → %s", (extra, expected) => {
    expect(loadEnv({ ...base, ...extra }).APP_VERSION).toBe(expected);
  });

  it("Moodle: chave de 32 bytes; busca insegura só nos testes", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(
      loadEnv({ ...production, INTEGRATION_ENCRYPTION_KEY: key }).INTEGRATION_ENCRYPTION_KEY,
    ).toBe(key);
    expect(() =>
      loadEnv({ ...production, INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...production, INTEGRATIONS_ALLOW_INSECURE_FETCH: "true" })).toThrow(
      /INTEGRATIONS_ALLOW_INSECURE_FETCH/,
    );
    expect(() => loadEnv({ ...base, INTEGRATIONS_ALLOW_INSECURE_FETCH: "true" })).toThrow(
      /INTEGRATIONS_ALLOW_INSECURE_FETCH/,
    );
    expect(
      loadEnv({ ...base, NODE_ENV: "test", INTEGRATIONS_ALLOW_INSECURE_FETCH: "true" })
        .INTEGRATIONS_ALLOW_INSECURE_FETCH,
    ).toBe(true);
  });

  it("aceita a configuração mínima de produção", () => {
    expect(() => loadEnv(production)).not.toThrow();
  });

  it("aceita o repasse de e-mail pelo app web com o segredo compartilhado", () => {
    const env = loadEnv({
      ...production,
      MAIL_TRANSPORT: "relay",
      API_PROXY_SECRET: "s".repeat(32),
    });
    expect(env.MAIL_TRANSPORT).toBe("relay");
  });

  it("aceita um segredo próprio para o repasse de e-mail, diferente do API_PROXY_SECRET", () => {
    const env = loadEnv({
      ...production,
      MAIL_TRANSPORT: "relay",
      API_PROXY_SECRET: "s".repeat(32),
      MAIL_RELAY_SECRET: "m".repeat(32),
    });
    expect(env.MAIL_RELAY_SECRET).toBe("m".repeat(32));
    expect(() =>
      loadEnv({
        ...production,
        MAIL_TRANSPORT: "relay",
        API_PROXY_SECRET: "s".repeat(32),
        MAIL_RELAY_SECRET: "s".repeat(32),
      }),
    ).toThrow(/diferente do API_PROXY_SECRET/);
  });

  it.each([
    ["1", 1],
    ["10.0.0.0/8, 127.0.0.1", ["10.0.0.0/8", "127.0.0.1"]],
    ["false", false],
  ])("TRUST_PROXY=%s vira %o", (raw, expected) => {
    expect(loadEnv({ ...base, TRUST_PROXY: raw }).TRUST_PROXY).toEqual(expected);
  });

  it.each([
    ["TRUST_PROXY=true", { TRUST_PROXY: "true" }, /TRUST_PROXY/],
    ["e-mail só no log", { MAIL_TRANSPORT: "log" }, /MAIL_TRANSPORT/],
    ["app sem HTTPS", { WEB_ORIGIN: "http://app.exemplo" }, /WEB_ORIGIN/],
    ["limites de tentativa afrouxados", { RATE_LIMIT_FACTOR: "10" }, /RATE_LIMIT_FACTOR/],
  ])("recusa em produção: %s", (_label, extra, error) => {
    expect(() => loadEnv({ ...production, ...extra })).toThrow(error);
  });

  it.each([
    ["smtp sem SMTP_URL", { MAIL_TRANSPORT: "smtp" }, /SMTP_URL/],
    ["resend sem chave", { MAIL_TRANSPORT: "resend" }, /RESEND_API_KEY/],
    ["relay sem segredo", { MAIL_TRANSPORT: "relay" }, /MAIL_RELAY_SECRET/],
    ["Google pela metade", { GOOGLE_CLIENT_ID: "id" }, /GOOGLE_CLIENT_SECRET/],
  ])("recusa configuração incompleta: %s", (_label, extra, error) => {
    expect(() => loadEnv({ ...base, ...extra })).toThrow(error);
  });

  it.each([
    [{}, true],
    [{ OPENAPI_ENABLED: "" }, true],
    [{ OPENAPI_ENABLED: "false" }, false],
  ])("OPENAPI_ENABLED fora de produção com %o → %s", (extra, expected) => {
    expect(loadEnv({ ...base, ...extra }).OPENAPI_ENABLED).toBe(expected);
  });

  it.each([
    [{}, false],
    [{ OPENAPI_ENABLED: "" }, false],
    [{ OPENAPI_ENABLED: "true" }, true],
  ])("OPENAPI_ENABLED em produção com %o → %s", (extra, expected) => {
    expect(loadEnv({ ...production, ...extra }).OPENAPI_ENABLED).toBe(expected);
  });

  it("checagem de senhas vazadas: desligada por padrão, liga com HIBP_ENABLED=true", () => {
    expect(loadEnv(base).HIBP_ENABLED).toBe(false);
    expect(loadEnv({ ...base, NODE_ENV: "test" }).HIBP_ENABLED).toBe(false);
    expect(loadEnv({ ...base, HIBP_ENABLED: "true" }).HIBP_ENABLED).toBe(true);
  });

  it("normaliza WEB_ORIGIN (sem barra final) para comparar com o cabeçalho Origin", () => {
    expect(loadEnv({ ...base, WEB_ORIGIN: "https://app.exemplo/" }).WEB_ORIGIN).toBe(
      "https://app.exemplo",
    );
  });

  it("lista todas as variáveis faltando de uma vez", () => {
    expect(() => loadEnv({})).toThrow(/WEB_ORIGIN[\s\S]*DATABASE_URL[\s\S]*REDIS_URL/);
  });
});
