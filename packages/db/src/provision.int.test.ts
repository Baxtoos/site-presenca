import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import { provisionBackupRole, provisionRoles, urlForRole } from "./provision";

/**
 * Simula um Postgres gerenciado (Neon etc.): o banco já existe, o administrador NÃO é superusuário
 * (só CREATEROLE/CREATEDB e dono do banco) e o script de infra/postgres/init não rodou.
 */
let container: StartedPostgreSqlContainer;
let adminUrl: string;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withUsername("postgres")
    .withPassword("postgres_test")
    .start();
  const su = new pg.Client({ connectionString: container.getConnectionUri() });
  await su.connect();
  await su.query(
    "create role dono_gerenciado login createrole createdb password 'senha-do-dono-1234'",
  );
  await su.query("create database gerenciado owner dono_gerenciado");
  await su.end();
  adminUrl = `postgres://dono_gerenciado:senha-do-dono-1234@${container.getHost()}:${container.getPort()}/gerenciado`;
});
afterAll(async () => {
  await container?.stop();
});

async function as<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe("provisionRoles", () => {
  it("cria os papéis, gera as senhas e deixa o banco pronto para as migrations", async () => {
    const result = await provisionRoles({ adminUrl });
    expect(result.database).toBe("gerenciado");
    expect(result.generated.sort()).toEqual(["app_api", "app_owner", "app_worker"]);
    expect(new Set(Object.values(result.passwords)).size).toBe(3);
    expect(result.urls.app_api).toContain("app_api:");
    expect(result.urls.app_api).toContain("/gerenciado");

    await runMigrations(result.urls.app_owner);

    // RLS forçado nas 17 tabelas, como no ensaio de deploy.
    const rls = await as(result.urls.app_owner, (c) =>
      c.query(
        "select count(*)::int as n from pg_class where relnamespace = 'app'::regnamespace and relkind = 'r' and relforcerowsecurity",
      ),
    );
    expect(rls.rows[0]).toEqual({ n: 17 });

    // A API enxerga o schema app sem prefixo, mas não pode criar nada nem enxergar sem usuário.
    await as(result.urls.app_api, async (c) => {
      expect((await c.query("show search_path")).rows[0]).toEqual({ search_path: "app" });
      expect((await c.query("select count(*)::int as n from users")).rows[0]).toEqual({ n: 0 });
      await expect(c.query("create table app.intruso (id int)")).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query("create table public.intruso (id int)")).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query("select * from migrations.journal")).rejects.toThrow(
        /permission denied/,
      );
    });

    // O worker não é superusuário nem ignora RLS, e não lê o hash de senha.
    await as(result.urls.app_worker, async (c) => {
      const flags = await c.query(
        "select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user",
      );
      expect(flags.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
      await expect(c.query("select password_hash from users")).rejects.toThrow(/permission denied/);
    });

    // O papel de funções de auth não loga.
    const auth = await as(adminUrl, (c) =>
      c.query("select rolcanlogin from pg_roles where rolname = 'app_auth'"),
    );
    expect(auth.rows[0]).toEqual({ rolcanlogin: false });
  });

  it("rodar de novo troca as senhas sem estragar nada (a antiga deixa de valer)", async () => {
    const before = await provisionRoles({
      adminUrl,
      passwords: { app_api: "senha-api-antiga-1234567", app_owner: "senha-dono-fixa-1234567" },
    });
    expect(before.generated).toEqual(["app_worker"]);
    const after = await provisionRoles({
      adminUrl,
      passwords: { app_api: "senha-api-nova-123456789", app_owner: "senha-dono-fixa-1234567" },
    });
    await expect(as(before.urls.app_api, async () => undefined)).rejects.toThrow(
      /password authentication failed/,
    );
    await as(after.urls.app_api, async (c) => {
      expect((await c.query("select 1 as ok")).rows[0]).toEqual({ ok: 1 });
    });
    // Migrations de novo: nada pendente, nada quebra (idempotente).
    await runMigrations(after.urls.app_owner);
  });

  it("recusa senha curta antes de tocar no banco", async () => {
    await expect(provisionRoles({ adminUrl, passwords: { app_api: "curta" } })).rejects.toThrow(
      /muito curta/,
    );
  });

  it("urlForRole mantém host, banco e parâmetros e protege caracteres especiais", () => {
    const url = urlForRole(
      "postgres://a:b@host.exemplo:5432/db?sslmode=require",
      "app_api",
      "p@ss/w:rd#1",
    );
    const parsed = new URL(url);
    expect(parsed.host).toBe("host.exemplo:5432");
    expect(parsed.pathname).toBe("/db");
    expect(parsed.searchParams.get("sslmode")).toBe("require");
    expect(decodeURIComponent(parsed.password)).toBe("p@ss/w:rd#1");
    expect(parsed.username).toBe("app_api");
  });
});

describe("provisionBackupRole", () => {
  it("dá login ao app_backup só de leitura, sem trocar as senhas dos outros papéis", async () => {
    const roles = await provisionRoles({ adminUrl });
    await runMigrations(roles.urls.app_owner);

    const url = await provisionBackupRole({ adminUrl });
    expect(url).toContain("app_backup:");
    await as(url, async (c) => {
      const { rows } = await c.query("select current_setting('search_path') as sp");
      expect(rows[0]).toEqual({ sp: "app" });
      await c.query("select count(*) from users");
      await expect(c.query("delete from users")).rejects.toThrow(/permission denied/);
    });
    // A API continua entrando com a mesma senha.
    await as(roles.urls.app_api, (c) => c.query("select 1"));

    // Rodar de novo troca só a senha do backup.
    const again = await provisionBackupRole({ adminUrl });
    expect(again).not.toBe(url);
    await as(again, (c) => c.query("select 1"));
    await expect(as(url, (c) => c.query("select 1"))).rejects.toThrow(/password authentication/);
  });
});
