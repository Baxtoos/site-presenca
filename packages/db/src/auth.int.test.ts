import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx, seedUser, startTestDb, type SeededUser, type TestDb } from "./testing/harness";

let db: TestDb;
let alice: SeededUser;
const ALICE_EMAIL = "alice@exemplo.com";

beforeAll(async () => {
  db = await startTestDb();
  alice = await seedUser(db.pools.app_api, ALICE_EMAIL);
});
afterAll(async () => {
  await db?.stop();
});

const api = () => db.pools.app_api;
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Cria uma sessão para Alice e devolve o hash do token, como o cookie faria. */
async function createSession(overrides: { createdAt?: string; expiresAt?: string } = {}) {
  const token = randomBytes(32).toString("base64url");
  const hash = sha256(token);
  await inTx(api(), { userId: alice.userId }, (c) =>
    c.query(
      `insert into sessions (user_id, token_hash, created_at, expires_at)
       values ($1, $2, coalesce($3::timestamptz, now()), coalesce($4::timestamptz, now() + interval '30 days'))`,
      [alice.userId, hash, overrides.createdAt ?? null, overrides.expiresAt ?? null],
    ),
  );
  return hash;
}

describe("app.auth_find_user_by_email", () => {
  it("acha a conta sem app.user_id, ignorando maiúsculas e espaços", async () => {
    const { rows } = await api().query(
      "select user_id, status, email_verified from app.auth_find_user_by_email($1)",
      ["  Alice@Exemplo.COM "],
    );
    expect(rows).toEqual([{ user_id: alice.userId, status: "active", email_verified: false }]);
  });

  it("não acha e-mail inexistente", async () => {
    const { rows } = await api().query("select * from app.auth_find_user_by_email($1)", [
      "ninguem@exemplo.com",
    ]);
    expect(rows).toEqual([]);
  });

  it("a função não abre o resto da tabela: sem contexto, users continua invisível", async () => {
    await api().query("select * from app.auth_find_user_by_email($1)", [ALICE_EMAIL]);
    const { rows } = await api().query("select count(*)::int as n from users");
    expect(rows[0]).toEqual({ n: 0 });
  });
});

describe("app.auth_resolve_session", () => {
  const resolve = async (hash: Buffer) =>
    (
      await api().query<{ user_id: string }>("select user_id from app.auth_resolve_session($1)", [
        hash,
      ])
    ).rows;

  it("resolve uma sessão válida", async () => {
    expect(await resolve(await createSession())).toEqual([{ user_id: alice.userId }]);
  });

  it("ignora token desconhecido", async () => {
    expect(await resolve(randomBytes(32))).toEqual([]);
  });

  it("ignora sessão expirada", async () => {
    const hash = await createSession({
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(await resolve(hash)).toEqual([]);
  });

  it("ignora sessão revogada", async () => {
    const hash = await createSession();
    await inTx(api(), { userId: alice.userId }, (c) =>
      c.query("update sessions set revoked_at = now() where token_hash = $1", [hash]),
    );
    expect(await resolve(hash)).toEqual([]);
  });

  it("ignora sessão de conta desativada", async () => {
    const bob = await seedUser(api(), `bob-${randomUUID()}@exemplo.com`);
    const hash = sha256("token-do-bob");
    await inTx(api(), { userId: bob.userId }, async (c) => {
      await c.query(
        "insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
        [bob.userId, hash],
      );
      await c.query("update users set status = 'disabled' where id = $1", [bob.userId]);
    });
    expect(await resolve(hash)).toEqual([]);
  });
});

describe("app.auth_issue_token e app.auth_consume_token", () => {
  const issue = (userId: string | null, email: string, ttl = 900, purpose = "reset_password") => {
    const hash = randomBytes(32);
    return api()
      .query("select app.auth_issue_token($1, $2, $3, $4, $5) as id", [
        userId,
        email,
        purpose,
        hash,
        ttl,
      ])
      .then(() => hash);
  };
  const consume = async (hash: Buffer, purpose = "reset_password") =>
    (
      await api().query<{ user_id: string | null; email: string }>(
        "select user_id, email from app.auth_consume_token($1, $2)",
        [hash, purpose],
      )
    ).rows;

  it("o link funciona uma vez só", async () => {
    const hash = await issue(alice.userId, ALICE_EMAIL);
    expect(await consume(hash)).toEqual([{ user_id: alice.userId, email: ALICE_EMAIL }]);
    expect(await consume(hash)).toEqual([]);
  });

  it("dois cliques simultâneos no mesmo link: só um vale", async () => {
    const hash = await issue(alice.userId, ALICE_EMAIL);
    const results = await Promise.all([consume(hash), consume(hash), consume(hash)]);
    expect(results.filter((r) => r.length === 1)).toHaveLength(1);
  });

  it("um link novo invalida o anterior do mesmo e-mail e finalidade", async () => {
    const first = await issue(alice.userId, ALICE_EMAIL);
    const second = await issue(alice.userId, ALICE_EMAIL);
    expect(await consume(first)).toEqual([]);
    expect(await consume(second)).toHaveLength(1);
  });

  it("link de uma finalidade não serve para outra", async () => {
    const hash = await issue(alice.userId, ALICE_EMAIL, 900, "verify_email");
    expect(await consume(hash, "reset_password")).toEqual([]);
    expect(await consume(hash, "verify_email")).toHaveLength(1);
  });

  it("magic link de cadastro devolve só o e-mail", async () => {
    const hash = await issue(null, "Nova@Exemplo.com", 900, "magic_link");
    expect(await consume(hash, "magic_link")).toEqual([
      { user_id: null, email: "nova@exemplo.com" },
    ]);
  });

  it("recusa emitir link para conta com outro e-mail", async () => {
    await expect(issue(alice.userId, "outro@exemplo.com")).rejects.toThrow(/não conferem/);
  });

  it("recusa validade fora de 1 min a 48 h", async () => {
    await expect(issue(alice.userId, ALICE_EMAIL, 30)).rejects.toThrow(/validade/);
    await expect(issue(alice.userId, ALICE_EMAIL, 3 * 86_400)).rejects.toThrow(/validade/);
  });

  it("link expirado não funciona", async () => {
    const hash = await issue(alice.userId, ALICE_EMAIL, 60);
    await db.admin.query(
      `update app.auth_tokens
          set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        where token_hash = $1`,
      [hash],
    );
    expect(await consume(hash)).toEqual([]);
  });
});

describe("app.auth_find_account", () => {
  it("acha a conta pelo sub do Google", async () => {
    const { rows } = await api().query("select app.auth_find_account('google', $1) as user_id", [
      `google-${alice.userId}`,
    ]);
    expect(rows[0]).toEqual({ user_id: alice.userId });
  });
});

describe("quem pode executar", () => {
  it("o worker não executa funções de autenticação", async () => {
    await expect(
      db.pools.app_worker.query("select * from app.auth_find_user_by_email('a@b.co')"),
    ).rejects.toThrow(/permission denied/);
  });

  it("app_auth não faz login", async () => {
    const { rows } = await db.pools.app_owner.query(
      "select rolcanlogin, rolbypassrls from pg_roles where rolname = 'app_auth'",
    );
    expect(rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: false });
  });
});
