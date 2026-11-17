import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  inTx,
  OWNED_TABLES,
  seedUser,
  startTestDb,
  type SeededUser,
  type TestDb,
} from "./test/harness";

let db: TestDb;
let alice: SeededUser;
let bob: SeededUser;

beforeAll(async () => {
  db = await startTestDb();
  alice = await seedUser(db.pools.app_api, "alice@exemplo.com");
  bob = await seedUser(db.pools.app_api, "bob@exemplo.com");
});

afterAll(async () => {
  await db?.stop();
});

const api = () => db.pools.app_api;
const count = async (
  c: { query: (s: string) => Promise<{ rows: { n: string }[] }> },
  sql: string,
) => Number((await c.query(`select count(*) as n from (${sql}) q`)).rows[0]!.n);

describe("isolamento entre usuários (RLS)", () => {
  it.each(OWNED_TABLES)("%s: cada um vê só as próprias linhas", async (table, col) => {
    await inTx(api(), { userId: bob.userId }, async (c) => {
      const total = await count(c, `select 1 from ${table}`);
      const mine = await count(c, `select 1 from ${table} where ${col} = '${bob.userId}'`);
      const fromAlice = await count(c, `select 1 from ${table} where ${col} = '${alice.userId}'`);
      expect(mine).toBeGreaterThan(0);
      expect(total).toBe(mine);
      expect(fromAlice).toBe(0);
    });
  });

  it.each(OWNED_TABLES)("%s: sem app.user_id nada é visível (falha fechada)", async (table) => {
    await inTx(api(), {}, async (c) => {
      expect(await count(c, `select 1 from ${table}`)).toBe(0);
    });
  });

  it("nem o dono das tabelas escapa do RLS forçado", async () => {
    await inTx(db.pools.app_owner, {}, async (c) => {
      expect(await count(c, "select 1 from semesters")).toBe(0);
    });
  });

  it("não altera nem apaga linhas de outra pessoa", async () => {
    await inTx(api(), { userId: bob.userId }, async (c) => {
      const upd = await c.query("update semesters set label = 'invadido' where id = $1", [
        alice.semesterId,
      ]);
      const del = await c.query("delete from attendance_logs where id = $1", [alice.logId]);
      expect(upd.rowCount).toBe(0);
      expect(del.rowCount).toBe(0);
    });
    await inTx(api(), { userId: alice.userId }, async (c) => {
      expect(await count(c, `select 1 from attendance_logs where id = '${alice.logId}'`)).toBe(1);
    });
  });

  it("não grava linha em nome de outra pessoa", async () => {
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query(
          `insert into semesters (user_id, label, starts_on, ends_on)
           values ($1, '2099.1', '2099-02-01', '2099-07-01')`,
          [alice.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("não troca o dono de uma linha própria", async () => {
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query("update semesters set user_id = $1 where id = $2", [alice.userId, bob.semesterId]),
      ),
    ).rejects.toThrow(/row-level security|foreign key/);
  });

  it("a view de totais também é isolada", async () => {
    await inTx(api(), { userId: bob.userId }, async (c) => {
      const rows = (await c.query("select user_id from subject_totals")).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r: { user_id: string }) => r.user_id === bob.userId)).toBe(true);
    });
  });
});

describe("integridade entre donos (FKs compostas)", () => {
  it("não liga matéria ao semestre de outra pessoa, mesmo sabendo o id", async () => {
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query(
          `insert into subjects (user_id, semester_id, name, counting_mode, total_classes)
           values ($1, $2, 'Intrusa', 'class_count', 10)`,
          [bob.userId, alice.semesterId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("o horário de um registro precisa ser da mesma matéria", async () => {
    await expect(
      inTx(api(), { userId: alice.userId }, async (c) => {
        const other = (
          await c.query<{ id: string }>(
            `insert into subjects (user_id, semester_id, name, counting_mode, total_classes)
             values ($1, $2, 'Física', 'class_count', 30) returning id`,
            [alice.userId, alice.semesterId],
          )
        ).rows[0]!.id;
        await c.query(
          `insert into attendance_logs
             (user_id, subject_id, schedule_id, class_date, status, units_scheduled, units_missed)
           values ($1, $2, $3, '2026-03-10', 'present', 2, 0)`,
          [alice.userId, other, alice.scheduleId],
        );
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it("apagar o horário só zera a referência, o registro de presença continua", async () => {
    await inTx(api(), { userId: alice.userId }, async (c) => {
      const schedule = (
        await c.query<{ id: string }>(
          `insert into subject_schedules (user_id, subject_id, weekday, starts_at, ends_at)
           values ($1, $2, 4, '08:00', '09:40') returning id`,
          [alice.userId, alice.subjectId],
        )
      ).rows[0]!.id;
      const log = (
        await c.query<{ id: string }>(
          `insert into attendance_logs
             (user_id, subject_id, schedule_id, class_date, status, units_scheduled, units_missed)
           values ($1, $2, $3, '2026-03-05', 'present', 1, 0) returning id`,
          [alice.userId, alice.subjectId, schedule],
        )
      ).rows[0]!.id;
      await c.query("delete from subject_schedules where id = $1", [schedule]);
      const after = (
        await c.query("select schedule_id, subject_id from attendance_logs where id = $1", [log])
      ).rows[0];
      expect(after).toEqual({ schedule_id: null, subject_id: alice.subjectId });
    });
  });
});

describe("restrições de dados", () => {
  const insertLog = (status: string, scheduled: number, missed: number, excused = false) =>
    inTx(api(), { userId: alice.userId }, (c) =>
      c.query(
        `insert into attendance_logs
           (user_id, subject_id, class_date, status, units_scheduled, units_missed, is_excused)
         values ($1, $2, '2026-05-05', $3, $4, $5, $6)`,
        [alice.userId, alice.subjectId, status, scheduled, missed, excused],
      ),
    );

  it.each([
    ["falta total com tempos perdidos diferentes do previsto", "absent", 2, 1, false],
    ["falta parcial sem perder tempo", "partial", 2, 0, false],
    ["falta parcial perdendo todos os tempos", "partial", 2, 2, false],
    ["presença com tempo perdido", "present", 2, 1, false],
    ["presença marcada como abonada", "present", 2, 0, true],
    ["aula cancelada abonada", "cancelled", 2, 0, true],
  ] as const)("recusa %s", async (_label, status, scheduled, missed, excused) => {
    await expect(insertLog(status, scheduled, missed, excused)).rejects.toThrow(/check constraint/);
  });

  it("uma ocorrência de aula gera um registro só (inclusive aula extra sem horário)", async () => {
    await insertLog("present", 1, 0);
    await expect(insertLog("absent", 1, 1)).rejects.toThrow(/attendance_logs_one_per_occurrence/);
  });

  it("e-mail precisa estar em minúsculas", async () => {
    const id = randomUUID();
    await expect(
      inTx(api(), { userId: id }, (c) =>
        c.query("insert into users (id, email, full_name) values ($1, 'Ana@Exemplo.com', 'Ana')", [
          id,
        ]),
      ),
    ).rejects.toThrow(/users_email_lower_chk/);
  });

  it("matéria por carga horária exige carga, tipo de hora e duração do tempo", async () => {
    await expect(
      inTx(api(), { userId: alice.userId }, (c) =>
        c.query(
          `insert into subjects (user_id, semester_id, name, counting_mode, workload_hours)
           values ($1, $2, 'Incompleta', 'workload', 60)`,
          [alice.userId, alice.semesterId],
        ),
      ),
    ).rejects.toThrow(/subjects_mode_fields_chk/);
  });

  it("alerta de limite exige percentual (campo NULL não passa pelo CHECK)", async () => {
    await expect(
      inTx(api(), { userId: alice.userId }, (c) =>
        c.query(
          `insert into notification_logs (user_id, subject_id, kind, channel, cycle, dedupe_key)
           values ($1, $2, 'threshold', 'email', 1, 'sem-percentual')`,
          [alice.userId, alice.subjectId],
        ),
      ),
    ).rejects.toThrow(/notification_logs_threshold_chk/);
  });

  it("só um semestre atual por pessoa", async () => {
    await expect(
      inTx(api(), { userId: alice.userId }, (c) =>
        c.query(
          `insert into semesters (user_id, label, starts_on, ends_on, is_current)
           values ($1, '2026.2', '2026-08-03', '2026-12-18', true)`,
          [alice.userId],
        ),
      ),
    ).rejects.toThrow(/semesters_one_current_idx/);
  });
});

describe("view subject_totals", () => {
  it("deriva os totais dos registros e respeita a política de atestado", async () => {
    await inTx(api(), { userId: bob.userId }, async (c) => {
      // Bob já tem 1 falta total de 2 tempos. Soma uma parcial abonada de 1 tempo.
      await c.query(
        `insert into attendance_logs
           (user_id, subject_id, class_date, status, units_scheduled, units_missed, is_excused)
         values ($1, $2, '2026-03-17', 'partial', 2, 1, true)`,
        [bob.userId, bob.subjectId],
      );
      const totals = async () =>
        (
          await c.query<{ units_counted: number; units_excused: number; units_held: number }>(
            "select units_counted, units_excused, units_held from subject_totals where subject_id = $1",
            [bob.subjectId],
          )
        ).rows[0];

      // track_only: o atestado é só controle pessoal e conta no limite.
      expect(await totals()).toEqual({ units_counted: 3, units_excused: 1, units_held: 4 });

      await c.query("update subjects set excused_policy = 'deduct' where id = $1", [bob.subjectId]);
      expect(await totals()).toEqual({ units_counted: 2, units_excused: 1, units_held: 4 });
    });
  });
});

describe("auditoria e versão", () => {
  it("criação, edição e exclusão viram eventos com o request_id", async () => {
    const requestId = `req-${randomUUID()}`;
    const logId = await inTx(api(), { userId: alice.userId, requestId }, async (c) => {
      const id = (
        await c.query<{ id: string }>(
          `insert into attendance_logs
             (user_id, subject_id, class_date, status, units_scheduled, units_missed)
           values ($1, $2, '2026-06-02', 'absent', 2, 2) returning id`,
          [alice.userId, alice.subjectId],
        )
      ).rows[0]!.id;
      await c.query(
        "update attendance_logs set status = 'partial', units_missed = 1 where id = $1",
        [id],
      );
      await c.query("delete from attendance_logs where id = $1", [id]);
      return id;
    });

    const events = await inTx(
      api(),
      { userId: alice.userId },
      async (c) =>
        (
          await c.query<{
            action: string;
            request_id: string;
            antes: string | null;
            depois: string | null;
          }>(
            `select action, request_id, before->>'status' as antes, after->>'status' as depois
             from attendance_log_events where log_id = $1 order by id`,
            [logId],
          )
        ).rows,
    );
    expect(events).toEqual([
      { action: "insert", request_id: requestId, antes: null, depois: "absent" },
      { action: "update", request_id: requestId, antes: "absent", depois: "partial" },
      { action: "delete", request_id: requestId, antes: "partial", depois: null },
    ]);
  });

  it.each([
    [
      "inserir",
      "insert into attendance_log_events (log_id, user_id, action) values (app.uuid_v7(), app.current_user_id(), 'insert')",
    ],
    ["alterar", "update attendance_log_events set action = 'delete'"],
    ["apagar", "delete from attendance_log_events"],
  ])("a API não consegue %s eventos de auditoria", async (_label, sql) => {
    await expect(inTx(api(), { userId: alice.userId }, (c) => c.query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("toda edição incrementa version e atualiza updated_at", async () => {
    const row = await inTx(api(), { userId: alice.userId }, async (c) => {
      await c.query("select pg_sleep(0.01)");
      return (
        await c.query<{ version: number; touched: boolean }>(
          `update semesters set label = '2026.1b' where id = $1
           returning version, updated_at > created_at as touched`,
          [alice.semesterId],
        )
      ).rows[0];
    });
    expect(row).toEqual({ version: 2, touched: true });
  });
});

describe("papéis", () => {
  it("o worker lê notificações de todos, mas não os registros de presença", async () => {
    const worker = db.pools.app_worker;
    expect(await count(worker, "select 1 from notification_logs")).toBe(2);
    await expect(worker.query("select * from attendance_logs")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("o worker lê o e-mail, mas não o hash de senha", async () => {
    const worker = db.pools.app_worker;
    expect(await count(worker, "select email from users")).toBeGreaterThanOrEqual(2);
    await expect(worker.query("select password_hash from users")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a API não enxerga o histórico de migrations", async () => {
    await expect(api().query("select * from migrations.journal")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a API não altera a estrutura do banco", async () => {
    await expect(api().query("alter table semesters add column x int")).rejects.toThrow(
      /must be owner/,
    );
  });
});

describe("app.uuid_v7()", () => {
  it("gera UUID versão 7, ordenável por tempo", async () => {
    const { rows } = await api().query<{ a: string; b: string }>(
      "select app.uuid_v7() as a, (select app.uuid_v7() from pg_sleep(0.002)) as b",
    );
    const { a, b } = rows[0]!;
    expect(a[14]).toBe("7");
    expect(b[14]).toBe("7");
    expect(b > a).toBe(true);
  });
});
