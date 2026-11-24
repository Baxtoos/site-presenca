import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { runMigrations } from "../migrate";

/** O mesmo script de papéis do desenvolvimento local: o teste valida o provisionamento real. */
const INIT_SQL = resolve(__dirname, "../../../../infra/postgres/init/01-roles.sql");

export type Role = "app_owner" | "app_api" | "app_worker" | "app_backup";
const PASSWORDS: Record<Role, string> = {
  app_owner: "app_owner_dev",
  app_api: "app_api_dev",
  app_worker: "app_worker_dev",
  app_backup: "app_backup_dev",
};

export interface TestDb {
  container: StartedPostgreSqlContainer;
  pools: Record<Role, pg.Pool>;
  /** URLs de conexão de cada papel (para subir a API ou o worker contra este banco). */
  urls: Record<Role, string>;
  /** Superusuário, SÓ para preparar cenários de teste (ex.: envelhecer um token). */
  admin: pg.Pool;
  stop(): Promise<void>;
}

/** Sobe Postgres 17, cria os papéis e aplica as migrations como app_owner. */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withUsername("postgres")
    .withPassword("postgres_test")
    .withDatabase("postgres")
    .withCopyFilesToContainer([
      { source: INIT_SQL, target: "/docker-entrypoint-initdb.d/01-roles.sql" },
    ])
    .start();

  const url = (role: Role) =>
    `postgres://${role}:${PASSWORDS[role]}@${container.getHost()}:${container.getPort()}/presenca`;

  await runMigrations(url("app_owner"));

  const pools = {
    app_owner: new pg.Pool({ connectionString: url("app_owner"), max: 2 }),
    app_api: new pg.Pool({ connectionString: url("app_api"), max: 4 }),
    app_worker: new pg.Pool({ connectionString: url("app_worker"), max: 2 }),
    app_backup: new pg.Pool({ connectionString: url("app_backup"), max: 1 }),
  };
  const admin = new pg.Pool({
    connectionString: `postgres://postgres:postgres_test@${container.getHost()}:${container.getPort()}/presenca`,
    max: 1,
  });

  return {
    container,
    pools,
    urls: {
      app_owner: url("app_owner"),
      app_api: url("app_api"),
      app_worker: url("app_worker"),
      app_backup: url("app_backup"),
    },
    admin,
    async stop() {
      await Promise.all([...Object.values(pools), admin].map((p) => p.end()));
      await container.stop();
    },
  };
}

export interface Context {
  userId?: string | null;
  requestId?: string;
}

/**
 * Executa numa transação identificada, como a API faz (set_config local à transação).
 * Faz rollback em caso de erro e repassa o erro.
 */
export async function inTx<T>(
  pool: pg.Pool,
  ctx: Context,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (ctx.userId) await client.query("select set_config('app.user_id', $1, true)", [ctx.userId]);
    if (ctx.requestId) {
      await client.query("select set_config('app.request_id', $1, true)", [ctx.requestId]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Código de compartilhamento válido (Crockford base32, 8 caracteres). */
function templateCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return Array.from(randomBytes(8), (b) => alphabet[b % 32]).join("");
}

export interface SeededUser {
  userId: string;
  semesterId: string;
  subjectId: string;
  scheduleId: string;
  logId: string;
  templateId: string;
  taskId: string;
}

/** Cria um usuário com pelo menos uma linha em cada tabela, agindo como a API (papel app_api). */
export async function seedUser(api: pg.Pool, email: string): Promise<SeededUser> {
  const userId = randomUUID();
  return inTx(api, { userId, requestId: `seed-${email}` }, async (c) => {
    const one = async (sql: string, params: unknown[]) =>
      (await c.query<{ id: string }>(sql, params)).rows[0]!.id;

    await c.query("insert into users (id, email, full_name) values ($1, $2, 'Pessoa Teste')", [
      userId,
      email,
    ]);
    const semesterId = await one(
      `insert into semesters (user_id, label, starts_on, ends_on, is_current)
       values ($1, '2026.1', '2026-02-02', '2026-07-03', true) returning id`,
      [userId],
    );
    const subjectId = await one(
      `insert into subjects (user_id, semester_id, name, counting_mode, total_classes, units_per_class)
       values ($1, $2, 'Cálculo II', 'class_count', 36, 2) returning id`,
      [userId, semesterId],
    );
    const scheduleId = await one(
      `insert into subject_schedules (user_id, subject_id, weekday, starts_at, ends_at, units)
       values ($1, $2, 2, '19:00', '20:40', 2) returning id`,
      [userId, subjectId],
    );
    const logId = await one(
      `insert into attendance_logs
         (user_id, subject_id, schedule_id, class_date, status, units_scheduled, units_missed)
       values ($1, $2, $3, '2026-03-03', 'absent', 2, 2) returning id`,
      [userId, subjectId, scheduleId],
    );
    await c.query(
      `insert into calendar_exceptions (user_id, semester_id, starts_on, ends_on, kind, label)
       values ($1, $2, '2026-04-21', '2026-04-21', 'holiday', 'Tiradentes')`,
      [userId, semesterId],
    );
    await c.query(
      `insert into subject_threshold_state (subject_id, threshold_pct, user_id) values ($1, 50, $2)`,
      [subjectId, userId],
    );
    const taskId = (
      await c.query<{ id: string }>(
        `insert into tasks (user_id, subject_id, title, due_at)
         values ($1, $2, 'Lista de exercícios', '2026-03-20 23:59-03') returning id`,
        [userId, subjectId],
      )
    ).rows[0]!.id;
    await c.query(
      `insert into moodle_connections (user_id, ics_host, ics_url_enc, sync_enabled)
       values ($1, 'moodle.exemplo.edu.br', 'v1.cifrado', false)`,
      [userId],
    );
    await c.query(
      `insert into moodle_course_mappings (user_id, course_key, subject_id) values ($1, 'TURMA1', $2)`,
      [userId, subjectId],
    );
    await c.query("insert into notification_preferences (user_id) values ($1)", [userId]);
    await c.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, $2, 'chave', 'segredo')`,
      [userId, `https://push.exemplo/${userId}`],
    );
    await c.query(
      `insert into notification_logs (user_id, subject_id, kind, channel, threshold_pct, cycle, dedupe_key)
       values ($1, $2, 'threshold', 'email', 50, 1, $3)`,
      [userId, subjectId, `threshold:${subjectId}:50:1`],
    );
    await c.query(
      `insert into idempotency_keys (user_id, key, request_hash, status_code)
       values ($1, 'chave-idempotente-1', $2, 201)`,
      [userId, randomBytes(32)],
    );
    await c.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '30 days')`,
      [userId, randomBytes(32)],
    );
    await c.query(
      `insert into auth_tokens (user_id, email, purpose, token_hash, expires_at)
       values ($1, $2, 'verify_email', $3, now() + interval '1 day')`,
      [userId, email, randomBytes(32)],
    );
    await c.query(
      `insert into auth_accounts (user_id, provider, provider_account_id, email)
       values ($1, 'google', $2, $3)`,
      [userId, `google-${userId}`, email],
    );
    await c.query(
      `insert into user_mfa (user_id, secret_ciphertext, enabled_at) values ($1, $2, now())`,
      [userId, randomBytes(48)],
    );
    await c.query(`insert into mfa_recovery_codes (user_id, code_hash) values ($1, $2)`, [
      userId,
      randomBytes(32),
    ]);
    const templateId = await one(
      `insert into shared_templates (owner_id, kind, code, title, payload)
       values ($1, 'semester', $2, 'Grade 2026.1', '{"subjects": []}') returning id`,
      [userId, templateCode()],
    );
    await c.query(
      `insert into template_imports (template_id, user_id, created_semester_id) values ($1, $2, $3)`,
      [templateId, userId, semesterId],
    );
    return { userId, semesterId, subjectId, scheduleId, logId, templateId, taskId };
  });
}

/** Todas as tabelas de dados do aluno e a coluna de dono de cada uma. */
export const OWNED_TABLES: ReadonlyArray<readonly [table: string, ownerColumn: string]> = [
  ["users", "id"],
  ["auth_accounts", "user_id"],
  ["sessions", "user_id"],
  ["auth_tokens", "user_id"],
  ["semesters", "user_id"],
  ["subjects", "user_id"],
  ["subject_schedules", "user_id"],
  ["calendar_exceptions", "user_id"],
  ["attendance_logs", "user_id"],
  ["attendance_log_events", "user_id"],
  ["subject_threshold_state", "user_id"],
  ["shared_templates", "owner_id"],
  ["template_imports", "user_id"],
  ["notification_preferences", "user_id"],
  ["push_subscriptions", "user_id"],
  ["notification_logs", "user_id"],
  ["idempotency_keys", "user_id"],
  ["user_mfa", "user_id"],
  ["mfa_recovery_codes", "user_id"],
  ["tasks", "user_id"],
  ["moodle_connections", "user_id"],
  ["moodle_course_mappings", "user_id"],
];
