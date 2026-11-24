import { randomUUID } from "node:crypto";
import {
  calendarResponseSchema,
  meResponseSchema,
  problemSchema,
  subjectSchema,
  taskListSchema,
  taskSchema,
} from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
} from "../test/auth-harness";

let env: AuthTestEnv;
beforeAll(async () => {
  env = await startAuthTestEnv();
});
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
const key = () => ({ "idempotency-key": randomUUID() });
const ifMatch = (version: number) => ({ "if-match": `"${version}"` });
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());

async function student() {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `tarefas.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-das-tarefas-1",
    fullName: "Aluna Tarefas",
  });
  expect(reg.statusCode).toBe(200);
  return { b, userId: meResponseSchema.parse(reg.json()).id };
}
type Student = Awaited<ReturnType<typeof student>>;

async function subjectOf(s: Student, name = "Cálculo II") {
  const sem = await s.b.request("POST", "/v1/semesters", {
    label: `2026.2-${++seq}`,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    isCurrent: false,
  });
  expect(sem.statusCode, sem.body).toBe(201);
  const res = await s.b.request("POST", `/v1/semesters/${sem.json<{ id: string }>().id}/subjects`, {
    name,
    color: "teal",
    unitsPerClass: 2,
    countingMode: "class_count",
    totalClasses: 36,
    minAttendanceBp: 7500,
  });
  expect(res.statusCode, res.body).toBe(201);
  return subjectSchema.parse(res.json());
}

const create = (s: Student, body: object, headers = key()) =>
  s.b.request("POST", "/v1/tasks", body, { headers });

/** Envios de aviso de uma tarefa como o worker gravaria (direto no banco, sem o worker). */
async function queueReminder(userId: string, taskId: string) {
  for (const [channel, status] of [
    ["in_app", "sent"],
    ["push", "pending"],
    ["email", "pending"],
  ] as const) {
    await env.db.admin.query(
      `insert into app.notification_logs (user_id, task_id, kind, channel, dedupe_key, status, payload)
       values ($1, $2, 'task_due', $3, $4, $5, '{}')`,
      [userId, taskId, channel, `task_due:${taskId}:teste`, status],
    );
  }
}

const reminderStatus = async (taskId: string) =>
  Object.fromEntries(
    (
      await env.db.admin.query<{ channel: string; status: string }>(
        `select channel, status from app.notification_logs where dedupe_key = $1`,
        [`task_due:${taskId}:teste`],
      )
    ).rows.map((r) => [r.channel, r.status]),
  );

describe("Tarefas e entregas (/v1/tasks)", () => {
  it("cria com o prazo no fuso da conta, repete pela mesma chave e lista por prazo", async () => {
    const ana = await student();
    const calc = await subjectOf(ana);
    const headers = key();
    const body = {
      title: "  Lista 3  ",
      notes: "Exercícios 1 a 10",
      subjectId: calc.id,
      dueAt: "2026-11-20T23:59",
    };
    const res = await create(ana, body, headers);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    const task = taskSchema.parse(res.json());
    expect(task).toMatchObject({
      title: "Lista 3",
      notes: "Exercícios 1 a 10",
      subject: { id: calc.id, name: "Cálculo II", color: "teal" },
      // 23:59 em São Paulo (UTC−3) = 02:59 do dia seguinte em UTC.
      dueAt: "2026-11-21T02:59:00.000Z",
      dueLocal: { date: "2026-11-20", time: "23:59" },
      remindBeforeMinutes: 1440,
      status: "pending",
      resolvedAt: null,
      overdue: false,
      version: 1,
    });

    const again = await create(ana, body, headers);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(taskSchema.parse(again.json()).id).toBe(task.id);

    await create(ana, { title: "Seminário", dueAt: "2026-11-19T10:00", remindBeforeMinutes: 180 });
    await create(ana, { title: "Prova", dueAt: "2026-12-01T08:00" });
    // Prazo já passou e ninguém marcou: vencida.
    await create(ana, { title: "Relatório antigo", dueAt: "2026-11-10T18:00" });

    const list = taskListSchema.parse((await ana.b.request("GET", "/v1/tasks")).json());
    expect(list.tasks.map((t) => t.title)).toEqual([
      "Relatório antigo",
      "Seminário",
      "Lista 3",
      "Prova",
    ]);
    expect(list.tasks[0]).toMatchObject({ overdue: true, status: "pending" });

    const desc = taskListSchema.parse(
      (await ana.b.request("GET", "/v1/tasks?order=due_desc&limit=2")).json(),
    );
    expect(desc.tasks.map((t) => t.title)).toEqual(["Prova", "Lista 3"]);
    const next = taskListSchema.parse(
      (
        await ana.b.request("GET", `/v1/tasks?order=due_desc&limit=2&cursor=${desc.nextCursor}`)
      ).json(),
    );
    expect(next.tasks.map((t) => t.title)).toEqual(["Seminário", "Relatório antigo"]);
    expect(next.nextCursor).toBeNull();

    const bySubject = taskListSchema.parse(
      (await ana.b.request("GET", `/v1/tasks?subjectId=${calc.id}`)).json(),
    );
    expect(bySubject.tasks.map((t) => t.title)).toEqual(["Lista 3"]);
  });

  it("valida os dados, exige a chave e não mistura contas", async () => {
    const ana = await student();
    const bia = await student();
    const biaSubject = await subjectOf(bia, "Física");

    const noKey = await ana.b.request("POST", "/v1/tasks", {
      title: "x",
      dueAt: "2026-11-20T10:00",
    });
    expect(noKey.statusCode).toBe(428);

    const badRemind = await create(ana, {
      title: "x",
      dueAt: "2026-11-20T10:00",
      remindBeforeMinutes: 45,
    });
    expect(badRemind.statusCode).toBe(422);
    expect(problem(badRemind).errors?.[0]?.path).toBe("remindBeforeMinutes");

    const badDate = await create(ana, { title: "x", dueAt: "2026-11-20 10:00" });
    expect(badDate.statusCode).toBe(422);

    const blank = await create(ana, { title: "   ", dueAt: "2026-11-20T10:00" });
    expect(blank.statusCode).toBe(422);

    // A matéria da Bia não serve para a tarefa da Ana.
    const foreign = await create(ana, {
      title: "x",
      subjectId: biaSubject.id,
      dueAt: "2026-11-20T10:00",
    });
    expect(foreign.statusCode).toBe(422);
    expect(problem(foreign)).toMatchObject({
      code: "TASK_INVALID",
      errors: [{ path: "subjectId", message: "Matéria não encontrada." }],
    });

    const mine = taskSchema.parse(
      (await create(ana, { title: "Só da Ana", dueAt: "2026-11-20T10:00" })).json(),
    );
    expect((await bia.b.request("GET", `/v1/tasks/${mine.id}`)).statusCode).toBe(404);
    const patch = await bia.b.request(
      "PATCH",
      `/v1/tasks/${mine.id}`,
      { title: "invadido" },
      { headers: ifMatch(1) },
    );
    expect(patch.statusCode).toBe(404);
    const del = await bia.b.request("DELETE", `/v1/tasks/${mine.id}`, undefined, {
      headers: ifMatch(1),
    });
    expect(del.statusCode).toBe(404);
    const biaList = taskListSchema.parse((await bia.b.request("GET", "/v1/tasks")).json());
    expect(biaList.tasks).toEqual([]);
  });

  it("marca concluída e não concluída (e volta), com If-Match; concluir cancela os envios pendentes", async () => {
    const ana = await student();
    const task = taskSchema.parse(
      (await create(ana, { title: "Trabalho final", dueAt: "2026-11-19T23:00" })).json(),
    );
    await queueReminder(ana.userId, task.id);

    const noIfMatch = await ana.b.request("PATCH", `/v1/tasks/${task.id}`, { status: "completed" });
    expect(noIfMatch.statusCode).toBe(428);

    const done = await ana.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { status: "completed" },
      { headers: ifMatch(1) },
    );
    expect(done.statusCode, done.body).toBe(200);
    expect(done.headers.etag).toBe('"2"');
    expect(taskSchema.parse(done.json())).toMatchObject({
      status: "completed",
      resolvedAt: "2026-11-18T15:00:00.000Z",
      overdue: false,
    });
    // Push e e-mail ainda na fila deixam de sair; o aviso do sino fica no histórico.
    expect(await reminderStatus(task.id)).toEqual({
      in_app: "sent",
      push: "skipped",
      email: "skipped",
    });

    // Versão velha: 412.
    const stale = await ana.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { status: "not_completed" },
      { headers: ifMatch(1) },
    );
    expect(stale.statusCode).toBe(412);

    const notDone = await ana.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { status: "not_completed" },
      { headers: ifMatch(2) },
    );
    expect(taskSchema.parse(notDone.json())).toMatchObject({ status: "not_completed", version: 3 });

    const back = await ana.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { status: "pending" },
      { headers: ifMatch(3) },
    );
    expect(taskSchema.parse(back.json())).toMatchObject({ status: "pending", resolvedAt: null });

    const pending = taskListSchema.parse(
      (await ana.b.request("GET", "/v1/tasks?status=pending")).json(),
    );
    expect(pending.tasks.map((t) => t.id)).toEqual([task.id]);
  });

  it("mudar o prazo cancela o aviso na fila; apagar cancela e mantém o histórico", async () => {
    const ana = await student();
    const task = taskSchema.parse(
      (await create(ana, { title: "Resenha", dueAt: "2026-11-19T12:00" })).json(),
    );
    await queueReminder(ana.userId, task.id);
    // Editar só o título não mexe no aviso.
    const renamed = taskSchema.parse(
      (
        await ana.b.request(
          "PATCH",
          `/v1/tasks/${task.id}`,
          { title: "Resenha crítica", notes: "" },
          { headers: ifMatch(1) },
        )
      ).json(),
    );
    expect(renamed).toMatchObject({ title: "Resenha crítica", notes: null });
    expect((await reminderStatus(task.id)).push).toBe("pending");

    const moved = taskSchema.parse(
      (
        await ana.b.request(
          "PATCH",
          `/v1/tasks/${task.id}`,
          { dueAt: "2026-11-25T12:00" },
          { headers: ifMatch(2) },
        )
      ).json(),
    );
    expect(moved.dueLocal).toEqual({ date: "2026-11-25", time: "12:00" });
    expect(await reminderStatus(task.id)).toMatchObject({ push: "skipped", email: "skipped" });

    const other = taskSchema.parse(
      (await create(ana, { title: "Apagar", dueAt: "2026-11-19T12:00" })).json(),
    );
    await queueReminder(ana.userId, other.id);
    const stale = await ana.b.request("DELETE", `/v1/tasks/${other.id}`, undefined, {
      headers: ifMatch(9),
    });
    expect(stale.statusCode).toBe(412);
    const del = await ana.b.request("DELETE", `/v1/tasks/${other.id}`, undefined, {
      headers: ifMatch(1),
    });
    expect(del.statusCode).toBe(204);
    expect((await ana.b.request("GET", `/v1/tasks/${other.id}`)).statusCode).toBe(404);
    expect(await reminderStatus(other.id)).toEqual({
      in_app: "sent",
      push: "skipped",
      email: "skipped",
    });
    const kept = await env.db.admin.query(
      `select task_id from app.notification_logs where dedupe_key = $1`,
      [`task_due:${other.id}:teste`],
    );
    expect(kept.rows.every((r: { task_id: string | null }) => r.task_id === null)).toBe(true);
  });

  it("apagar a matéria mantém a tarefa; o export LGPD traz as tarefas", async () => {
    const ana = await student();
    const calc = await subjectOf(ana, "Química");
    const task = taskSchema.parse(
      (await create(ana, { title: "Lab 2", subjectId: calc.id, dueAt: "2026-11-22T20:00" })).json(),
    );
    const del = await ana.b.request("DELETE", `/v1/subjects/${calc.id}`, undefined, {
      headers: ifMatch(calc.version),
    });
    expect(del.statusCode, del.body).toBe(204);
    const after = taskSchema.parse((await ana.b.request("GET", `/v1/tasks/${task.id}`)).json());
    expect(after).toMatchObject({ subjectId: null, subject: null, title: "Lab 2" });

    const exp = await ana.b.request("GET", "/v1/me/export.json");
    expect(exp.statusCode).toBe(200);
    const data = exp.json<{ tasks: { id: string; title: string }[] }>();
    expect(data.tasks).toEqual([expect.objectContaining({ id: task.id, title: "Lab 2" })]);
  });

  it("filtra por dias locais (bordas de 23:59), aceita tarefa sem aviso e link https da atividade", async () => {
    const ana = await student();
    // 23:59 de domingo em São Paulo é 02:59 de segunda em UTC: precisa cair no domingo.
    const sunday = taskSchema.parse(
      (
        await create(ana, {
          title: "Entrega de domingo",
          dueAt: "2026-11-29T23:59",
          remindBeforeMinutes: null,
          externalUrl: "https://moodle.exemplo.edu.br/mod/assign/view.php?id=42",
        })
      ).json(),
    );
    expect(sunday).toMatchObject({
      remindBeforeMinutes: null,
      externalUrl: "https://moodle.exemplo.edu.br/mod/assign/view.php?id=42",
      source: "manual",
      statusSource: "user",
    });
    await create(ana, { title: "Segunda cedo", dueAt: "2026-11-30T00:00" });
    await create(ana, { title: "Sábado", dueAt: "2026-11-28T00:00" });

    const titles = async (qs: string) =>
      taskListSchema
        .parse((await ana.b.request("GET", `/v1/tasks?${qs}`)).json())
        .tasks.map((t) => t.title);
    expect(await titles("from=2026-11-29&to=2026-11-29")).toEqual(["Entrega de domingo"]);
    expect(await titles("from=2026-11-30")).toEqual(["Segunda cedo"]);
    expect(await titles("to=2026-11-28")).toEqual(["Sábado"]);
    expect(await titles("from=2026-11-28&to=2026-11-30")).toHaveLength(3);

    const backwards = await ana.b.request("GET", "/v1/tasks?from=2026-12-01&to=2026-11-01");
    expect(backwards.statusCode).toBe(422);
    const tooLong = await ana.b.request("GET", "/v1/tasks?from=2026-01-01&to=2027-03-01");
    expect(tooLong.statusCode).toBe(422);

    for (const externalUrl of [
      "http://moodle.exemplo.edu.br/x",
      "javascript:alert(1)",
      "https://127.0.0.1/",
    ]) {
      const bad = await create(ana, { title: "x", dueAt: "2026-11-20T10:00", externalUrl });
      expect(bad.statusCode, externalUrl).toBe(422);
      expect(problem(bad).errors?.[0]?.path).toBe("externalUrl");
    }

    // Ligar o aviso e tirar o link; desligar de novo cancela o que estava na fila.
    const on = await ana.b.request(
      "PATCH",
      `/v1/tasks/${sunday.id}`,
      { remindBeforeMinutes: 60, externalUrl: "" },
      { headers: ifMatch(sunday.version) },
    );
    expect(on.statusCode, on.body).toBe(200);
    const withReminder = taskSchema.parse(on.json());
    expect(withReminder).toMatchObject({ remindBeforeMinutes: 60, externalUrl: null });
    await queueReminder(ana.userId, sunday.id);
    const off = await ana.b.request(
      "PATCH",
      `/v1/tasks/${sunday.id}`,
      { remindBeforeMinutes: null },
      { headers: ifMatch(withReminder.version) },
    );
    expect(off.statusCode, off.body).toBe(200);
    expect(await reminderStatus(sunday.id)).toEqual({
      in_app: "sent",
      push: "skipped",
      email: "skipped",
    });
  });

  it("marcação do aluno vira statusSource user, mesmo sobre uma tarefa importada", async () => {
    const ana = await student();
    const task = taskSchema.parse(
      (await create(ana, { title: "Questionário 4", dueAt: "2026-11-25T23:59" })).json(),
    );
    // Simula o que a sincronização do Moodle fará: tarefa importada e concluída pelo Moodle.
    await env.db.admin.query(
      `update app.tasks set source = 'moodle_ics', external_uid = 'uid-123@moodle',
              status = 'completed', resolved_at = now(), status_source = 'sync' where id = $1`,
      [task.id],
    );
    const synced = taskSchema.parse((await ana.b.request("GET", `/v1/tasks/${task.id}`)).json());
    expect(synced).toMatchObject({
      source: "moodle_ics",
      status: "completed",
      statusSource: "sync",
    });

    const res = await ana.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { status: "not_completed" },
      { headers: ifMatch(synced.version) },
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(taskSchema.parse(res.json())).toMatchObject({
      status: "not_completed",
      statusSource: "user",
      source: "moodle_ics",
    });
  });

  it("calendário: tarefas no dia local, exceções e chamadas pendentes, sem misturar contas", async () => {
    const ana = await student();
    const bia = await student();
    // Semestre ativo com aula às segundas e quartas.
    const sem = await ana.b.request("POST", "/v1/semesters", {
      label: `Cal-${++seq}`,
      startsOn: "2026-08-03",
      endsOn: "2026-12-18",
      isCurrent: true,
    });
    expect(sem.statusCode, sem.body).toBe(201);
    const semesterId = sem.json<{ id: string }>().id;
    const subjectRes = await ana.b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
      name: "Redes",
      code: "RED1",
      color: "teal",
      unitsPerClass: 2,
      countingMode: "class_count",
      totalClasses: 36,
      minAttendanceBp: 7500,
      schedules: [
        { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2 },
        { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2 },
      ],
    });
    expect(subjectRes.statusCode, subjectRes.body).toBe(201);
    const subject = subjectSchema.parse(subjectRes.json());
    const monday = subject.schedules.find((s) => s.weekday === 1)!;
    for (const body of [
      {
        startsOn: "2026-11-11",
        endsOn: "2026-11-11",
        kind: "no_classes",
        label: "Semana de ciências",
      },
      { startsOn: "2026-11-16", endsOn: "2026-11-17", kind: "exam_week", label: "Provas" },
    ]) {
      const res = await ana.b.request("POST", `/v1/semesters/${semesterId}/exceptions`, body);
      expect(res.statusCode, res.body).toBe(201);
    }
    // Segunda 09/11 registrada; quarta 11/11 sem aula; segunda 16/11 ficou sem chamada.
    const att = await ana.b.request(
      "POST",
      "/v1/attendance",
      { subjectId: subject.id, classDate: "2026-11-09", scheduleId: monday.id, status: "present" },
      { headers: key() },
    );
    expect(att.statusCode, att.body).toBe(201);

    const sunday = taskSchema.parse(
      (
        await create(ana, { title: "Relatório", subjectId: subject.id, dueAt: "2026-11-15T23:59" })
      ).json(),
    );
    const done = taskSchema.parse(
      (await create(ana, { title: "Lista feita", dueAt: "2026-11-21T10:00" })).json(),
    );
    await ana.b.request(
      "PATCH",
      `/v1/tasks/${done.id}`,
      { status: "completed" },
      { headers: ifMatch(done.version) },
    );
    await create(bia, { title: "Da Bia", dueAt: "2026-11-15T12:00" });

    const res = await ana.b.request("GET", "/v1/calendar?from=2026-11-09&to=2026-11-22");
    expect(res.statusCode, res.body).toBe(200);
    const cal = calendarResponseSchema.parse(res.json());
    expect(cal).toMatchObject({ today: "2026-11-18", timezone: "America/Sao_Paulo" });
    // O relatório (pendente, prazo já passou) conta como atrasado.
    expect(cal.overdueCount).toBe(1);
    const day = (date: string) => cal.days.find((d) => d.date === date);

    expect(day("2026-11-15")?.tasks.map((t) => t.id)).toEqual([sunday.id]);
    expect(day("2026-11-15")?.tasks[0]?.subject).toMatchObject({
      name: "Redes",
      code: "RED1",
      semesterLabel: expect.stringMatching(/^Cal-/),
    });
    expect(day("2026-11-16")?.tasks ?? []).toEqual([]);
    expect(day("2026-11-21")?.tasks.map((t) => t.status)).toEqual(["completed"]);
    expect(cal.days.flatMap((d) => d.tasks).some((t) => t.title === "Da Bia")).toBe(false);

    expect(day("2026-11-11")?.exceptions).toEqual([
      expect.objectContaining({
        kind: "no_classes",
        label: "Semana de ciências",
        subjectName: null,
      }),
    ]);
    expect(day("2026-11-17")?.exceptions.map((e) => e.label)).toContain("Provas");
    expect(day("2026-11-09")?.pendingClasses ?? 0).toBe(0);
    expect(day("2026-11-11")?.pendingClasses ?? 0).toBe(0);
    expect(day("2026-11-16")?.pendingClasses).toBe(1);
    // Hoje (quarta 18) e o futuro não contam como pendentes.
    expect(day("2026-11-18")?.pendingClasses ?? 0).toBe(0);

    const onlyDone = calendarResponseSchema.parse(
      (
        await ana.b.request("GET", "/v1/calendar?from=2026-11-09&to=2026-11-22&status=completed")
      ).json(),
    );
    expect(onlyDone.days.flatMap((d) => d.tasks).map((t) => t.title)).toEqual(["Lista feita"]);

    // Sem `classes`, a lista de aulas vem vazia (a linha do tempo não precisa).
    expect(cal.days.every((d) => d.classes.length === 0)).toBe(true);
    const withClasses = calendarResponseSchema.parse(
      (
        await ana.b.request("GET", "/v1/calendar?from=2026-11-09&to=2026-11-22&classes=true")
      ).json(),
    );
    const classesOf = (date: string) =>
      withClasses.days
        .find((d) => d.date === date)
        ?.classes.map((c) => [c.subjectName, c.startsAt, c.endsAt, c.state]) ?? [];
    expect(classesOf("2026-11-09")).toEqual([["Redes", "19:00", "20:40", "done"]]);
    expect(classesOf("2026-11-11")).toEqual([]); // dia sem aula: só a exceção
    expect(classesOf("2026-11-16")).toEqual([["Redes", "19:00", "20:40", "pending"]]);
    expect(classesOf("2026-11-18")).toEqual([["Redes", "19:00", "20:40", "upcoming"]]);
    expect(classesOf("2026-11-17")).toEqual([]); // terça: sem aula na grade
    expect(withClasses.days.find((d) => d.date === "2026-11-09")?.classes[0]?.color).toBe("teal");

    const bad = await ana.b.request("GET", "/v1/calendar?from=2026-01-01&to=2027-03-01");
    expect(bad.statusCode).toBe(422);
    const backwards = await ana.b.request("GET", "/v1/calendar?from=2026-11-22&to=2026-11-09");
    expect(backwards.statusCode).toBe(422);

    // A Bia não vê nada da Ana (nem chamadas pendentes nem exceções).
    const biaCal = calendarResponseSchema.parse(
      (await bia.b.request("GET", "/v1/calendar?from=2026-11-09&to=2026-11-22")).json(),
    );
    expect(biaCal.days.flatMap((d) => d.tasks).map((t) => t.title)).toEqual(["Da Bia"]);
    expect(biaCal.days.every((d) => d.pendingClasses === 0 && d.exceptions.length === 0)).toBe(
      true,
    );
  });
});
