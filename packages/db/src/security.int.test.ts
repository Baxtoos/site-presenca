import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  inTx,
  OWNED_TABLES,
  seedUser,
  startTestDb,
  type SeededUser,
  type TestDb,
} from "./testing/harness";

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

describe("tarefas (FKs compostas e restrições)", () => {
  it("não liga tarefa à matéria de outra pessoa, mesmo sabendo o id", async () => {
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query(
          `insert into tasks (user_id, subject_id, title, due_at) values ($1, $2, 'Intrusa', now())`,
          [bob.userId, alice.subjectId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("apagar a matéria mantém a tarefa, só sem matéria", async () => {
    await inTx(api(), { userId: alice.userId }, async (c) => {
      const subject = (
        await c.query<{ id: string }>(
          `insert into subjects (user_id, semester_id, name, counting_mode, total_classes)
           values ($1, $2, 'Temporária', 'class_count', 10) returning id`,
          [alice.userId, alice.semesterId],
        )
      ).rows[0]!.id;
      const task = (
        await c.query<{ id: string }>(
          `insert into tasks (user_id, subject_id, title, due_at)
           values ($1, $2, 'Relatório', now() + interval '3 days') returning id`,
          [alice.userId, subject],
        )
      ).rows[0]!.id;
      await c.query("delete from subjects where id = $1", [subject]);
      const after = (await c.query("select subject_id, user_id from tasks where id = $1", [task]))
        .rows[0];
      expect(after).toEqual({ subject_id: null, user_id: alice.userId });
    });
  });

  it("apagar a tarefa mantém o aviso no histórico, sem a tarefa", async () => {
    await inTx(api(), { userId: alice.userId }, async (c) => {
      const task = (
        await c.query<{ id: string }>(
          `insert into tasks (user_id, title, due_at) values ($1, 'Seminário', now()) returning id`,
          [alice.userId],
        )
      ).rows[0]!.id;
      const log = (
        await c.query<{ id: string }>(
          `insert into notification_logs (user_id, task_id, kind, channel, dedupe_key, status)
           values ($1, $2, 'system', 'in_app', $3, 'sent') returning id`,
          [alice.userId, task, `teste-tarefa:${task}`],
        )
      ).rows[0]!.id;
      await c.query("delete from tasks where id = $1", [task]);
      const after = (
        await c.query("select task_id, user_id from notification_logs where id = $1", [log])
      ).rows[0];
      expect(after).toEqual({ task_id: null, user_id: alice.userId });
    });
  });

  it("aviso não aponta para a tarefa de outra pessoa", async () => {
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query(
          `insert into notification_logs (user_id, task_id, kind, channel, dedupe_key)
           values ($1, $2, 'system', 'in_app', 'intruso')`,
          [bob.userId, alice.taskId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it.each([
    ["título vazio", "title", "'   '"],
    ["antecedência fora das opções", "remind_before_minutes", "45"],
    ["concluída sem data de conclusão", "status", "'completed'"],
    ["link sem https", "external_url", "'http://moodle.exemplo.edu.br/a'"],
    ["link javascript:", "external_url", "'javascript:alert(1)'"],
    ["importada sem identificador", "source", "'moodle_ics'"],
    ["manual com identificador", "external_uid", "'uid-1'"],
  ])("recusa %s", async (_name, column, value) => {
    await expect(
      inTx(api(), { userId: alice.userId }, (c) =>
        c.query(`update tasks set ${column} = ${value} where id = $1`, [alice.taskId]),
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("aceita tarefa sem aviso (antecedência nula) e link https", async () => {
    await inTx(api(), { userId: alice.userId }, async (c) => {
      await c.query(
        `update tasks set remind_before_minutes = null,
                external_url = 'https://moodle.exemplo.edu.br/mod/assign/view.php?id=1' where id = $1`,
        [alice.taskId],
      );
    });
  });

  it("uma tarefa importada por identificador de origem, por conta", async () => {
    const insert = (c: { query: (q: string, v: unknown[]) => Promise<unknown> }, userId: string) =>
      c.query(
        `insert into tasks (user_id, title, due_at, source, external_uid)
         values ($1, 'Questionário', now(), 'moodle_ics', 'uid-repetido@moodle')`,
        [userId],
      );
    await inTx(api(), { userId: alice.userId }, async (c) => {
      await insert(c, alice.userId);
      await c.query("savepoint dup");
      await expect(insert(c, alice.userId)).rejects.toThrow(/tasks_external_uid_key/);
      await c.query("rollback to savepoint dup");
      await c.query("delete from tasks where external_uid is not null");
    });
    await inTx(api(), { userId: bob.userId }, async (c) => {
      await insert(c, bob.userId);
      await c.query("delete from tasks where external_uid is not null");
    });
  });

  it("toda edição incrementa version e atualiza updated_at", async () => {
    await inTx(api(), { userId: alice.userId }, async (c) => {
      const before = (
        await c.query<{ version: number }>("select version from tasks where id = $1", [
          alice.taskId,
        ])
      ).rows[0]!.version;
      await c.query("update tasks set status = 'completed', resolved_at = now() where id = $1", [
        alice.taskId,
      ]);
      const after = (
        await c.query<{ version: number }>("select version from tasks where id = $1", [
          alice.taskId,
        ])
      ).rows[0]!.version;
      expect(after).toBe(before + 1);
    });
  });
});

describe("notas (FKs compostas, mesma matéria e restrições)", () => {
  const itemOf = async (userId: string) =>
    (
      await db.admin.query<{ id: string; subject_id: string }>(
        "select id, subject_id from app.evaluation_items where user_id = $1 limit 1",
        [userId],
      )
    ).rows[0]!;

  it("avaliação e regra não usam a matéria de outra pessoa", async () => {
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query(
          `insert into evaluation_items (user_id, subject_id, key, name, max_score) values ($1, $2, 'X', 'X', 1000)`,
          [bob.userId, alice.subjectId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      inTx(api(), { userId: bob.userId }, (c) =>
        c.query(`insert into grading_schemes (user_id, subject_id, rules) values ($1, $2, '{}')`, [
          bob.userId,
          alice.subjectId,
        ]),
      ),
    ).rejects.toThrow(/foreign key|duplicate key/);
  });

  it("tarefa só liga a avaliação da mesma matéria; trocar a matéria desfaz a ligação", async () => {
    const item = await itemOf(alice.userId);
    await inTx(api(), { userId: alice.userId }, async (c) => {
      await c.query("update tasks set evaluation_item_id = $2 where id = $1", [
        alice.taskId,
        item.id,
      ]);
      const other = (
        await c.query<{ id: string }>(
          `insert into subjects (user_id, semester_id, name, counting_mode, total_classes)
           values ($1, $2, 'Outra', 'class_count', 10) returning id`,
          [alice.userId, alice.semesterId],
        )
      ).rows[0]!.id;
      const foreignTask = (
        await c.query<{ id: string }>(
          `insert into tasks (user_id, subject_id, title, due_at) values ($1, $2, 'De outra', now()) returning id`,
          [alice.userId, other],
        )
      ).rows[0]!.id;
      await c.query("savepoint s");
      await expect(
        c.query("update tasks set evaluation_item_id = $2 where id = $1", [foreignTask, item.id]),
      ).rejects.toThrow(/mesma matéria/);
      await c.query("rollback to savepoint s");
      await c.query("update tasks set subject_id = $2 where id = $1", [alice.taskId, other]);
      const after = (
        await c.query("select evaluation_item_id from tasks where id = $1", [alice.taskId])
      ).rows[0];
      expect(after).toEqual({ evaluation_item_id: null });
      throw new Error("desfaz");
    }).catch((e: Error) => expect(e.message).toBe("desfaz"));
  });

  it("apagar a avaliação só desliga a tarefa", async () => {
    await inTx(api(), { userId: alice.userId }, async (c) => {
      const id = (
        await c.query<{ id: string }>(
          `insert into evaluation_items (user_id, subject_id, key, name, max_score) values ($1, $2, 'T9', 'Trabalho', 1000) returning id`,
          [alice.userId, alice.subjectId],
        )
      ).rows[0]!.id;
      await c.query("update tasks set evaluation_item_id = $2 where id = $1", [alice.taskId, id]);
      await c.query("delete from evaluation_items where id = $1", [id]);
      const after = (
        await c.query("select evaluation_item_id from tasks where id = $1", [alice.taskId])
      ).rows[0];
      expect(after).toEqual({ evaluation_item_id: null });
      throw new Error("desfaz");
    }).catch((e: Error) => expect(e.message).toBe("desfaz"));
  });

  it.each([
    ["nota acima da máxima", "score = 1001, scored_at = now()"],
    ["nota sem data", "score = 500"],
    ["papel inválido", "role = 'bonus'"],
    ["nome repetido (sem diferenciar maiúsculas)", "key = 'p1'"],
  ])("recusa %s", async (_name, set) => {
    const item = await itemOf(alice.userId);
    await expect(
      inTx(api(), { userId: alice.userId }, async (c) => {
        if (set.startsWith("key")) {
          await c.query(
            `insert into evaluation_items (user_id, subject_id, key, name, max_score) values ($1, $2, 'P1x', 'x', 1000)`,
            [alice.userId, alice.subjectId],
          );
          await c.query(`update evaluation_items set key = 'p1' where key = 'P1x'`);
        } else {
          await c.query(`update evaluation_items set ${set} where id = $1`, [item.id]);
        }
      }),
    ).rejects.toThrow(/violates|duplicate key/);
  });

  it("worker: não vê a regra; só importa nota do Moodle em avaliação ligada e nunca por cima do aluno", async () => {
    const worker = db.pools.app_worker;
    await expect(worker.query("select * from grading_schemes")).rejects.toThrow(
      /permission denied/,
    );
    const item = await itemOf(alice.userId);
    expect(
      (
        await worker.query(
          "update evaluation_items set score = 900, scored_at = now(), score_source = 'moodle' where id = $1",
          [item.id],
        )
      ).rowCount,
    ).toBe(0);
    await db.admin.query(
      "update app.evaluation_items set external_grade_item_id = 'gi-1', score_source = 'moodle' where id = $1",
      [item.id],
    );
    try {
      expect(
        (
          await worker.query(
            "update evaluation_items set score = 800, scored_at = now() where id = $1",
            [item.id],
          )
        ).rowCount,
      ).toBe(1);
      await expect(
        worker.query("update evaluation_items set score_source = 'user' where id = $1", [item.id]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        worker.query("update evaluation_items set name = 'x' where id = $1", [item.id]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.admin.query(
        "update app.evaluation_items set external_grade_item_id = null, score_source = 'user', score = null, scored_at = null where id = $1",
        [item.id],
      );
    }
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
  it("o worker lê notificações de todos, mas dos registros de presença só o necessário para o lembrete", async () => {
    const worker = db.pools.app_worker;
    expect(await count(worker, "select 1 from notification_logs")).toBeGreaterThanOrEqual(2);
    expect(
      await count(
        worker,
        "select user_id, subject_id, schedule_id, class_date from attendance_logs",
      ),
    ).toBeGreaterThanOrEqual(2);
    for (const column of ["*", "status", "note", "reason", "is_excused", "units_missed"]) {
      await expect(worker.query(`select ${column} from attendance_logs`)).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(worker.query("delete from notification_logs")).rejects.toThrow(
      /permission denied/,
    );
    await expect(worker.query("update semesters set label = 'x'")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("o worker não lê as observações nem mexe nas tarefas digitadas pelo aluno", async () => {
    const worker = db.pools.app_worker;
    expect(
      await count(
        worker,
        "select id, user_id, subject_id, title, due_at, remind_before_minutes, status, source from tasks",
      ),
    ).toBeGreaterThanOrEqual(2);
    for (const column of ["*", "notes"]) {
      await expect(worker.query(`select ${column} from tasks`)).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(worker.query("delete from tasks")).rejects.toThrow(/permission denied/);
    await expect(worker.query("update tasks set notes = 'x'")).rejects.toThrow(/permission denied/);
    const upd = await worker.query("update tasks set title = 'x' where source = 'manual'");
    expect(upd.rowCount).toBe(0);
    await expect(
      worker.query(
        `insert into tasks (user_id, title, due_at) values ('${alice.userId}', 'x', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("o worker só importa tarefas de quem tem a conexão do Moodle ligada", async () => {
    const worker = db.pools.app_worker;
    const insert = (userId: string, uid: string) =>
      worker.query<{ id: string }>(
        `insert into tasks (user_id, title, due_at, source, external_uid, external_course_key)
         values ($1, 'Importada', now() + interval '2 days', 'moodle_ics', $2, 'TURMA1') returning id`,
        [userId, uid],
      );
    await expect(insert(alice.userId, "uid-desligada")).rejects.toThrow(/row-level security/);

    await db.admin.query(
      "update app.moodle_connections set sync_enabled = true where user_id = $1",
      [alice.userId],
    );
    try {
      const id = (await insert(alice.userId, "uid-ligada")).rows[0]!.id;
      const upd = await worker.query(
        "update tasks set due_at = now() + interval '3 days', status = 'completed', resolved_at = now(), status_source = 'sync' where id = $1",
        [id],
      );
      expect(upd.rowCount).toBe(1);
      await expect(
        worker.query("update tasks set source = 'manual' where id = $1", [id]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        worker.query("update moodle_course_mappings set ignored = true"),
      ).rejects.toThrow(/permission denied/);
      expect(
        (await worker.query("update moodle_course_mappings set last_seen_at = now()")).rowCount,
      ).toBeGreaterThan(0);
      await expect(worker.query("update moodle_connections set ics_url_enc = 'x'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.admin.query("delete from app.tasks where external_uid = 'uid-ligada'");
      await db.admin.query(
        "update app.moodle_connections set sync_enabled = false where user_id = $1",
        [alice.userId],
      );
    }
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

describe("papel de backup (app_backup)", () => {
  const backup = () => db.pools.app_backup;
  const appTables = async () =>
    (
      await db.admin.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relkind in ('r', 'p') order by 1`,
      )
    ).rows.map((r) => r.relname);

  it("toda tabela do schema app tem a política backup_read (senão o backup sai vazio)", async () => {
    const { rows } = await db.admin.query<{ tablename: string }>(
      `select tablename from pg_policies
        where schemaname = 'app' and policyname = 'backup_read'
          and cmd = 'SELECT' and 'app_backup' = any(roles)`,
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual(await appTables());
  });

  it("toda tabela com RLS tem owner_maintenance (senão a restauração do backup falha)", async () => {
    const { rows } = await db.admin.query<{ relname: string }>(
      `select c.relname from pg_class c
        where c.relnamespace = 'app'::regnamespace and c.relkind = 'r' and c.relrowsecurity
          and not exists (select 1 from pg_policy p
                           where p.polrelid = c.oid and p.polname = 'owner_maintenance')
        order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("lê as linhas de todos os usuários, sem contexto", async () => {
    expect(await count(backup(), "select 1 from users")).toBeGreaterThanOrEqual(2);
    for (const [table] of OWNED_TABLES) {
      expect(await count(backup(), `select 1 from ${table}`)).toBeGreaterThan(0);
    }
  });

  it("não escreve nem altera a estrutura", async () => {
    await expect(backup().query("delete from semesters")).rejects.toThrow(/permission denied/);
    await expect(backup().query("update users set full_name = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      backup().query("insert into notification_logs (user_id) values (app.uuid_v7())"),
    ).rejects.toThrow(/permission denied/);
    await expect(backup().query("alter table semesters add column x int")).rejects.toThrow(
      /must be owner/,
    );
  });

  it("não tem superpoderes", async () => {
    const { rows } = await backup().query(
      "select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user",
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
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
