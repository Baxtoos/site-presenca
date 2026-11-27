import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle, isConnectionLost, withUser } from "./index";
import { seedUser, startTestDb, type TestDb } from "./testing/harness";

let db: TestDb;
let handle: DbHandle;
let userId: string;
beforeAll(async () => {
  db = await startTestDb();
  handle = createDb({ connectionString: db.urls.app_api, applicationName: "teste-conexao" });
  userId = (await seedUser(db.pools.app_api, `conexao.${Date.now()}@exemplo.com`)).userId;
});
afterAll(async () => {
  await handle?.close();
  await db?.stop();
});

describe("conexão encerrada pelo servidor (Neon reiniciando ou dormindo)", () => {
  it("a transação que caiu no meio é repetida uma vez numa conexão nova", async () => {
    let attempts = 0;
    const result = await withUser(handle.db, { userId }, async (tx) => {
      attempts++;
      if (attempts === 1) await tx.execute(sql`select pg_terminate_backend(pg_backend_pid())`);
      const rows = await tx.execute<{ id: string }>(sql`select id from app.users`);
      return rows.rows.map((r) => r.id);
    });
    expect(attempts).toBe(2);
    expect(result).toEqual([userId]);
  });

  it("conexão parada encerrada pelo servidor não derruba o processo", async () => {
    await handle.ping();
    await db.admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'teste-conexao' and state = 'idle'",
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(await handle.ping()).toBeGreaterThanOrEqual(0);
  });

  it("outros erros não são repetidos", async () => {
    let attempts = 0;
    await expect(
      withUser(handle.db, { userId }, async (tx) => {
        attempts++;
        await tx.execute(sql`select 1/0`);
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("reconhece os erros de conexão perdida, inclusive embrulhados", () => {
    expect(isConnectionLost({ code: "57P01" })).toBe(true);
    expect(isConnectionLost(new Error("x", { cause: { code: "57P01" } }))).toBe(true);
    expect(isConnectionLost(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isConnectionLost({ code: "23505" })).toBe(false);
    expect(isConnectionLost(undefined)).toBe(false);
  });
});
