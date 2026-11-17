import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv do worker", () => {
  it("aplica o intervalo padrão de 30 s", () => {
    const env = loadEnv({ WORKER_DATABASE_URL: "postgres://u:p@localhost:5432/presenca" });
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(30_000);
  });

  it("recusa subir sem a URL do banco", () => {
    expect(() => loadEnv({})).toThrow(/WORKER_DATABASE_URL/);
  });
});
