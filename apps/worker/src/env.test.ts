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
