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

describe("app.auth_issue_registration e app.auth_consume_registration (cadastro pendente)", () => {
  const issue = async (email: string, name = "Bia Souza", ttl = 86_400) => {
    const hash = randomBytes(32);
    await api().query("select app.auth_issue_registration($1, $2, $3, $4, $5)", [
      email,
      name,
      "$argon2id$hash-de-teste",
      hash,
      ttl,
    ]);
    return hash;
  };
  const consume = async (hash: Buffer) =>
    (
      await api().query<{ email: string; full_name: string; password_hash: string | null }>(
        "select email, full_name, password_hash from app.auth_consume_registration($1)",
        [hash],
      )
    ).rows;

  it("devolve e-mail, nome e hash uma vez só, e apaga o hash guardado", async () => {
    const hash = await issue("  Bia@Exemplo.com ");
    expect(await consume(hash)).toEqual([
      {
        email: "bia@exemplo.com",
        full_name: "Bia Souza",
        password_hash: "$argon2id$hash-de-teste",
      },
    ]);
    expect(await consume(hash)).toEqual([]);
    const { rows } = await db.admin.query(
      "select pending_password_hash, used_at is not null as used from app.auth_tokens where token_hash = $1",
      [hash],
    );
    expect(rows[0]).toEqual({ pending_password_hash: null, used: true });
  });

  it("um cadastro novo invalida o link anterior do mesmo e-mail (e apaga o hash dele)", async () => {
    const first = await issue("caio@exemplo.com");
    const second = await issue("caio@exemplo.com", "Caio Lima");
    expect(await consume(first)).toEqual([]);
    expect((await consume(second))[0]?.full_name).toBe("Caio Lima");
    const { rows } = await db.admin.query(
      "select count(*)::int as n from app.auth_tokens where token_hash = $1 and pending_password_hash is not null",
      [first],
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("link de cadastro não serve como magic link nem como nova senha", async () => {
    const hash = await issue("duda@exemplo.com");
    for (const purpose of ["magic_link", "reset_password"]) {
      const { rows } = await api().query("select * from app.auth_consume_token($1, $2)", [
        hash,
        purpose,
      ]);
      expect(rows).toEqual([]);
    }
  });

  it("link expirado não cria conta", async () => {
    const hash = await issue("eva@exemplo.com");
    await db.admin.query(
      "update app.auth_tokens set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where token_hash = $1",
      [hash],
    );
    expect(await consume(hash)).toEqual([]);
  });

  it("exclusão de conta usa o mesmo mecanismo de links, presa à conta", async () => {
    const hash = randomBytes(32);
    await api().query("select app.auth_issue_token($1, $2, 'delete_account', $3, 900)", [
      alice.userId,
      ALICE_EMAIL,
      hash,
    ]);
    const { rows } = await api().query(
      "select user_id, email from app.auth_consume_token($1, 'delete_account')",
      [hash],
    );
    expect(rows).toEqual([{ user_id: alice.userId, email: ALICE_EMAIL }]);
    await expect(
      api().query("select app.auth_issue_token(null, 'x@exemplo.com', 'delete_account', $1, 900)", [
        randomBytes(32),
      ]),
    ).rejects.toThrow(/auth_tokens_user_required_chk/);
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
  it("o worker não executa as funções de cadastro pendente", async () => {
    await expect(
      db.pools.app_worker.query("select * from app.auth_consume_registration($1)", [
        randomBytes(32),
      ]),
    ).rejects.toThrow(/permission denied/);
  });

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
