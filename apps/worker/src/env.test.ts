import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  WORKER_DATABASE_URL: "postgres://u:p@localhost:5432/presenca",
  WEB_ORIGIN: "http://localhost:3000/",
};

describe("loadEnv do worker", () => {
  it("aplica os padrões (30 s, e-mail no log, sem push) e tira a barra final do endereço", () => {
    const env = loadEnv(base);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(30_000);
    expect(env.MAIL_TRANSPORT).toBe("log");
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("modo contínuo por padrão; aceita once; recusa outro valor", () => {
    expect(loadEnv(base).WORKER_MODE).toBe("loop");
    expect(loadEnv({ ...base, WORKER_MODE: "once" }).WORKER_MODE).toBe("once");
    expect(() => loadEnv({ ...base, WORKER_MODE: "cron" })).toThrow(/WORKER_MODE/);
  });

  it("Moodle: sem chave fica desligado; busca insegura só nos testes", () => {
    expect(loadEnv(base).INTEGRATION_ENCRYPTION_KEY).toBeUndefined();
    expect(loadEnv(base).INTEGRATIONS_ALLOW_INSECURE_FETCH).toBe(false);
    expect(
      loadEnv({ ...base, NODE_ENV: "test", INTEGRATIONS_ALLOW_INSECURE_FETCH: "true" })
        .INTEGRATIONS_ALLOW_INSECURE_FETCH,
    ).toBe(true);
    for (const NODE_ENV of ["development", "production"]) {
      expect(() =>
        loadEnv({
          ...base,
          NODE_ENV,
          INTEGRATIONS_ALLOW_INSECURE_FETCH: "true",
          MAIL_TRANSPORT: "resend",
          RESEND_API_KEY: "re_x",
        }),
      ).toThrow(/INTEGRATIONS_ALLOW_INSECURE_FETCH/);
    }
  });

  it("recusa subir sem a URL do banco ou do app", () => {
    expect(() => loadEnv({})).toThrow(/WORKER_DATABASE_URL[\s\S]*WEB_ORIGIN/);
  });

  it.each([
    [
      "e-mail só no log em produção",
      { NODE_ENV: "production", MAIL_TRANSPORT: "log" },
      /MAIL_TRANSPORT/,
    ],
    ["smtp sem URL", { MAIL_TRANSPORT: "smtp" }, /SMTP_URL/],
    ["só uma das chaves VAPID", { VAPID_PUBLIC_KEY: "abc" }, /VAPID_PRIVATE_KEY/],
    ["contato VAPID inválido", { VAPID_SUBJECT: "eu@exemplo.com" }, /VAPID_SUBJECT/],
  ])("recusa %s", (_name, extra, error) => {
    expect(() => loadEnv({ ...base, ...extra })).toThrow(error);
  });
});
