import { resolve } from "node:path";
import pg from "pg";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {}

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

async function expectError(client, sql, pattern) {
  await client.query("savepoint probe");
  try {
    await client.query(sql);
    await client.query("rollback to savepoint probe");
    return { ok: false, detail: "o comando foi aceito" };
  } catch (error) {
    await client.query("rollback to savepoint probe");
    return { ok: pattern.test(error.message), detail: error.message };
  }
}

async function verifyRole(label, url) {
  if (!url) {
    check(`${label}: URL definida`, false, "variável ausente");
    return;
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    check(`${label}: conecta`, false, error.message || error.code || "erro sem mensagem");
    return;
  }
  check(`${label}: conecta`, true);
  try {
    const { rows } = await client.query(
      `select current_user as role, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
              current_setting('search_path') as search_path
         from pg_roles where rolname = current_user`,
    );
    const r = rows[0];
    check(`${label}: não é superusuário`, !r.rolsuper);
    check(`${label}: não ignora RLS`, !r.rolbypassrls);
    check(`${label}: não cria bancos nem papéis`, !r.rolcreatedb && !r.rolcreaterole);
    check(`${label}: search_path = app`, r.search_path === "app", r.search_path);

    await client.query("begin");
    const ddlApp = await expectError(
      client,
      "create table app.__probe (id int)",
      /permission denied/,
    );
    check(`${label}: não cria tabela no schema app`, ddlApp.ok, ddlApp.detail);
    const ddlPublic = await expectError(
      client,
      "create table public.__probe (id int)",
      /permission denied/,
    );
    check(`${label}: não cria tabela no schema public`, ddlPublic.ok, ddlPublic.detail);
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

await verifyRole("app_api", process.env.DATABASE_URL);
await verifyRole("app_worker", process.env.WORKER_DATABASE_URL);

for (const c of checks) {
  console.log(`${c.ok ? "✔" : "✘"} ${c.name}${!c.ok && c.detail ? `  (${c.detail})` : ""}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? "\nPapéis do banco OK." : `\n${failed} verificação(ões) falharam.`);
process.exit(failed === 0 ? 0 : 1);
