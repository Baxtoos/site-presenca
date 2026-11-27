import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  meResponseSchema,
  moodleCourseSchema,
  moodleGradesSchema,
  moodleStatusSchema,
  moodleSyncResultSchema,
  problemSchema,
  subjectGradingSchema,
  subjectSchema,
  taskListSchema,
  taskSchema,
} from "@presenca/contracts";
import { sealSecret, secretAad } from "@presenca/integrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
  TEST_INTEGRATION_KEY,
} from "../test/auth-harness";

let env: AuthTestEnv;
let server: Server;
let base: string;
const WSTOKEN = "tokenmoodlefalso1234";
let gradeItems: {
  id: number;
  itemname: string | null;
  itemtype: string;
  graderaw: number | null;
  grademax: number;
}[] = [];
const feeds = new Map<string, string>();

beforeAll(async () => {
  env = await startAuthTestEnv();
  server = createServer((req, res) => {
    if (req.url?.startsWith("/webservice/rest/server.php")) {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        const json = (body: unknown) =>
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
        if (form.get("wstoken") !== WSTOKEN)
          return json({ exception: "x", errorcode: "invalidtoken" });
        switch (form.get("wsfunction")) {
          case "core_webservice_get_site_info":
            return json({ userid: 7, sitename: "Moodle falso" });
          case "core_enrol_get_users_courses":
            return json([{ id: 10, shortname: "RED1 - 2026-2", fullname: "Redes" }]);
          case "gradereport_user_get_grade_items":
            return json({ usergrades: [{ gradeitems: gradeItems }] });
          default:
            return json({ courses: [] });
        }
      });
      return;
    }
    const token = new URL(req.url ?? "/", "http://x").searchParams.get("authtoken") ?? "";
    const feed = feeds.get(token);
    if (!feed) return res.writeHead(403).end("acesso negado");
    res.writeHead(200, { "content-type": "text/calendar" }).end(feed);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server?.close();
  await env?.stop();
});

let seq = 0;
const key = () => ({ "idempotency-key": randomUUID() });
const ifMatch = (version: number) => ({ "if-match": `"${version}"` });
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());
const icsLink = (token: string) =>
  `${base}/calendar/export_execute.php?userid=1&authtoken=${token}&preset_what=all`;

const ics = (events: { uid: string; summary: string; due: string; course?: string }[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `SUMMARY:${e.summary}`,
      `DTSTART:${e.due}`,
      `DTEND:${e.due}`,
      ...(e.course ? [`CATEGORIES:${e.course}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");

async function student() {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `moodle.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-do-moodle-1",
    fullName: "Aluna Moodle",
  });
  expect(reg.statusCode).toBe(200);
  const userId = meResponseSchema.parse(reg.json()).id;
  const sem = await b.request("POST", "/v1/semesters", {
    label: `M-${++seq}`,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    isCurrent: true,
  });
  expect(sem.statusCode, sem.body).toBe(201);
  const subject = subjectSchema.parse(
    (
      await b.request("POST", `/v1/semesters/${sem.json<{ id: string }>().id}/subjects`, {
        name: "Redes",
        code: "RED1",
        unitsPerClass: 2,
        countingMode: "class_count",
        totalClasses: 36,
        minAttendanceBp: 7500,
      })
    ).json(),
  );
  return { b, userId, subject };
}

const FEED = ics([
  {
    uid: "1@moodle",
    summary: "Lista 3 está para ser entregue",
    due: "20261120T025900Z",
    course: "RED1 - 2026-2",
  },
  {
    uid: "2@moodle",
    summary: "Questionário 2 abre",
    due: "20261119T120000Z",
    course: "RED1 - 2026-2",
  },
  {
    uid: "3@moodle",
    summary: "Relatório antigo está para ser entregue",
    due: "20261101T025900Z",
    course: "RED1 - 2026-2",
  },
  {
    uid: "4@moodle",
    summary: "Seminário is due",
    due: "20261205T025900Z",
    course: "OUTRA - 2026-2",
  },
]);

describe("Conector do Moodle (/v1/moodle)", () => {
  it("conecta: testa o link, guarda cifrado e importa; o link nunca volta na resposta", async () => {
    const ana = await student();
    const empty = moodleStatusSchema.parse((await ana.b.request("GET", "/v1/moodle")).json());
    expect(empty).toEqual({ available: true, connection: null });

    feeds.set("SEGREDO-ANA", FEED);
    const res = await ana.b.request("PUT", "/v1/moodle", { icsUrl: icsLink("SEGREDO-ANA") });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain("SEGREDO");
    expect(res.body).not.toContain("authtoken");
    const result = moodleSyncResultSchema.parse(res.json());
    expect(result).toMatchObject({ created: 2, completed: 0, courses: 2, warning: null });
    const conn = result.status.connection!;
    expect(conn).toMatchObject({
      icsHost: new URL(base).host,
      hasToken: false,
      syncEnabled: true,
      lastSyncError: null,
      importedCount: 2,
    });
    expect(conn.courses.map((c) => [c.courseKey, c.subjectId, c.taskCount])).toEqual([
      ["OUTRA - 2026-2", null, 1],
      ["RED1 - 2026-2", ana.subject.id, 1],
    ]);

    const stored = await env.db.admin.query<{ ics_url_enc: string }>(
      "select ics_url_enc from app.moodle_connections where user_id = $1",
      [ana.userId],
    );
    expect(stored.rows[0]!.ics_url_enc.startsWith("v1.")).toBe(true);
    expect(stored.rows[0]!.ics_url_enc).not.toContain("SEGREDO");

    const list = taskListSchema.parse((await ana.b.request("GET", "/v1/tasks")).json());
    expect(list.tasks.map((t) => [t.title, t.source, t.subject?.name ?? null])).toEqual([
      ["Lista 3", "moodle_ics", "Redes"],
      ["Seminário", "moodle_ics", null],
    ]);
  });

  it("recusa link que o Moodle não aceita, chave sem endereço e lixo; nada é guardado", async () => {
    const bia = await student();
    const refused = await bia.b.request("PUT", "/v1/moodle", { icsUrl: icsLink("ERRADO") });
    expect(refused.statusCode).toBe(422);
    expect(problem(refused)).toMatchObject({
      code: "MOODLE_INVALID",
      errors: [
        {
          path: "icsUrl",
          message: "O Moodle recusou o link. Gere um novo link do calendário e cole de novo.",
        },
      ],
    });
    const noBase = await bia.b.request("PUT", "/v1/moodle", {
      icsUrl: icsLink("ERRADO"),
      wstoken: "a1b2c3d4e5f6a7b8c9d0",
    });
    expect(noBase.statusCode).toBe(422);
    expect(problem(noBase).errors?.[0]?.path).toBe("baseUrl");
    for (const icsUrl of ["javascript:alert(1)", "não é link"]) {
      const bad = await bia.b.request("PUT", "/v1/moodle", { icsUrl });
      expect(bad.statusCode, icsUrl).toBe(422);
    }
    const status = moodleStatusSchema.parse((await bia.b.request("GET", "/v1/moodle")).json());
    expect(status.connection).toBeNull();
    expect(
      (await bia.b.request("POST", "/v1/moodle/sync", undefined, { headers: key() })).statusCode,
    ).toBe(404);
  });

  it("turmas: ligar a uma matéria atualiza as tarefas; ignorar some com as futuras e não reimporta", async () => {
    const caio = await student();
    feeds.set("SEGREDO-CAIO", FEED);
    const connected = moodleSyncResultSchema.parse(
      (await caio.b.request("PUT", "/v1/moodle", { icsUrl: icsLink("SEGREDO-CAIO") })).json(),
    );
    const other = connected.status.connection!.courses.find(
      (c) => c.courseKey === "OUTRA - 2026-2",
    )!;

    const noIfMatch = await caio.b.request("PATCH", `/v1/moodle/courses/${other.id}`, {
      subjectId: caio.subject.id,
    });
    expect(noIfMatch.statusCode).toBe(428);
    const linked = await caio.b.request(
      "PATCH",
      `/v1/moodle/courses/${other.id}`,
      { subjectId: caio.subject.id },
      { headers: ifMatch(other.version) },
    );
    expect(linked.statusCode, linked.body).toBe(200);
    const linkedCourse = moodleCourseSchema.parse(linked.json());
    expect(linkedCourse).toMatchObject({ subjectName: "Redes", ignored: false });
    const seminar = taskListSchema
      .parse((await caio.b.request("GET", "/v1/tasks")).json())
      .tasks.find((t) => t.title === "Seminário")!;
    expect(seminar.subject?.name).toBe("Redes");

    const ignored = await caio.b.request(
      "PATCH",
      `/v1/moodle/courses/${other.id}`,
      { ignored: true },
      { headers: ifMatch(linkedCourse.version) },
    );
    expect(moodleCourseSchema.parse(ignored.json())).toMatchObject({
      ignored: true,
      subjectId: null,
      taskCount: 0,
    });
    const sync = await caio.b.request("POST", "/v1/moodle/sync", undefined, { headers: key() });
    expect(sync.statusCode, sync.body).toBe(200);
    const titles = taskListSchema
      .parse((await caio.b.request("GET", "/v1/tasks")).json())
      .tasks.map((t) => t.title);
    expect(titles).toEqual(["Lista 3"]);

    const bia = await student();
    const foreign = await bia.b.request(
      "PATCH",
      `/v1/moodle/courses/${other.id}`,
      { ignored: false },
      { headers: ifMatch(2) },
    );
    expect(foreign.statusCode).toBe(404);
  });

  it("sincronizar agora: prazo adiado, repetição pela mesma chave e tarefa importada protegida", async () => {
    const duda = await student();
    feeds.set("SEGREDO-DUDA", FEED);
    await duda.b.request("PUT", "/v1/moodle", { icsUrl: icsLink("SEGREDO-DUDA") });
    feeds.set(
      "SEGREDO-DUDA",
      ics([
        {
          uid: "1@moodle",
          summary: "Lista 3 está para ser entregue",
          due: "20261127T025900Z",
          course: "RED1 - 2026-2",
        },
      ]),
    );
    const headers = key();
    const sync = await duda.b.request("POST", "/v1/moodle/sync", undefined, { headers });
    expect(sync.statusCode, sync.body).toBe(200);
    expect(moodleSyncResultSchema.parse(sync.json())).toMatchObject({ updated: 1, created: 0 });
    const again = await duda.b.request("POST", "/v1/moodle/sync", undefined, { headers });
    expect(again.headers["idempotent-replayed"]).toBe("true");

    const list = taskListSchema.parse((await duda.b.request("GET", "/v1/tasks")).json());
    const lista = list.tasks.find((t) => t.title === "Lista 3")!;
    expect(lista.dueLocal).toEqual({ date: "2026-11-26", time: "23:59" });

    const rename = await duda.b.request(
      "PATCH",
      `/v1/tasks/${lista.id}`,
      { title: "Outro nome" },
      { headers: ifMatch(lista.version) },
    );
    expect(rename.statusCode).toBe(422);
    expect(problem(rename)).toMatchObject({ code: "TASK_IMPORTED", errors: [{ path: "title" }] });
    const del = await duda.b.request("DELETE", `/v1/tasks/${lista.id}`, undefined, {
      headers: ifMatch(lista.version),
    });
    expect(del.statusCode).toBe(422);
    const done = await duda.b.request(
      "PATCH",
      `/v1/tasks/${lista.id}`,
      { status: "completed", notes: "Enviei pelo celular" },
      { headers: ifMatch(lista.version) },
    );
    expect(done.statusCode, done.body).toBe(200);
    expect(taskSchema.parse(done.json())).toMatchObject({
      status: "completed",
      statusSource: "user",
      source: "moodle_ics",
    });

    feeds.delete("SEGREDO-DUDA");
    const failed = await duda.b.request("POST", "/v1/moodle/sync", undefined, { headers: key() });
    expect(failed.statusCode).toBe(422);
    const status = moodleStatusSchema.parse((await duda.b.request("GET", "/v1/moodle")).json());
    expect(status.connection?.lastSyncError).toBe(
      "O Moodle recusou o link. Gere um novo link do calendário e cole de novo.",
    );
  });

  it("desconectar: mantendo as tarefas (viram manuais) ou apagando as futuras pendentes", async () => {
    for (const keepTasks of ["true", "false"] as const) {
      const eva = await student();
      const token = `SEGREDO-EVA-${keepTasks}`;
      feeds.set(token, FEED);
      const connected = moodleSyncResultSchema.parse(
        (await eva.b.request("PUT", "/v1/moodle", { icsUrl: icsLink(token) })).json(),
      );
      const version = connected.status.connection!.version;
      expect((await eva.b.request("DELETE", `/v1/moodle?keepTasks=${keepTasks}`)).statusCode).toBe(
        428,
      );
      const res = await eva.b.request("DELETE", `/v1/moodle?keepTasks=${keepTasks}`, undefined, {
        headers: ifMatch(version),
      });
      expect(res.statusCode, res.body).toBe(204);
      const status = moodleStatusSchema.parse((await eva.b.request("GET", "/v1/moodle")).json());
      expect(status.connection).toBeNull();
      const tasks = taskListSchema.parse((await eva.b.request("GET", "/v1/tasks")).json()).tasks;
      if (keepTasks === "true") {
        expect(tasks.map((t) => [t.title, t.source])).toEqual([
          ["Lista 3", "manual"],
          ["Seminário", "manual"],
        ]);
      } else {
        expect(tasks).toEqual([]);
      }
      const rows = await env.db.admin.query(
        "select 1 from app.moodle_connections where user_id = $1",
        [eva.userId],
      );
      expect(rows.rowCount).toBe(0);
    }
  });

  it("notas do Moodle: lista os itens, sugere pelo nome, liga e traz a nota; nota do aluno vence", async () => {
    const lia = await student();
    feeds.set("SEGREDO-LIA", FEED);
    await lia.b.request("PUT", "/v1/moodle", { icsUrl: icsLink("SEGREDO-LIA") });
    const noToken = moodleGradesSchema.parse(
      (await lia.b.request("GET", `/v1/subjects/${lia.subject.id}/moodle-grades`)).json(),
    );
    expect(noToken).toMatchObject({ available: false, items: [] });
    expect(noToken.reason).toMatch(/token/);

    const key = Buffer.from(TEST_INTEGRATION_KEY, "base64");
    const admin = await env.db.admin.connect();
    try {
      await admin.query("begin");
      await admin.query(
        "alter table app.moodle_connections drop constraint moodle_connections_base_url_chk",
      );
      await admin.query(
        "update app.moodle_connections set base_url = $2, wstoken_enc = $3 where user_id = $1",
        [lia.userId, base, sealSecret(WSTOKEN, key, secretAad(lia.userId, "wstoken"))],
      );
      await admin.query(
        `alter table app.moodle_connections add constraint moodle_connections_base_url_chk
           check (base_url is null or (base_url ~ '^https://' and char_length(base_url) <= 300)) not valid`,
      );
      await admin.query("commit");
    } finally {
      admin.release();
    }
    const grading = subjectGradingSchema.parse(
      (
        await lia.b.request("PUT", `/v1/subjects/${lia.subject.id}/grading`, {
          rules: { scale: 10, passing: 600, formula: "(P1 + Seminario) / 2" },
          items: [
            { key: "P1", name: "Prova 1", maxScore: 1000 },
            { key: "Seminario", name: "Seminário", maxScore: 1000 },
          ],
          source: "manual",
        })
      ).json(),
    );
    expect(grading.moodleLinkable).toBe(true);
    const [p1, sem] = grading.items;

    gradeItems = [
      { id: 0, itemname: null, itemtype: "course", graderaw: 70, grademax: 100 },
      { id: 900, itemname: "Prova 1", itemtype: "mod", graderaw: 7.5, grademax: 10 },
      { id: 901, itemname: "Seminário", itemtype: "mod", graderaw: null, grademax: 100 },
    ];
    const listed = moodleGradesSchema.parse(
      (await lia.b.request("GET", `/v1/subjects/${lia.subject.id}/moodle-grades`)).json(),
    );
    expect(listed).toMatchObject({ available: true, courseKey: "RED1 - 2026-2" });
    expect(listed.items.map((i) => [i.externalId, i.name, i.suggested])).toEqual([
      ["gi:900", "Prova 1", p1!.id],
      ["gi:901", "Seminário", sem!.id],
    ]);

    await lia.b.request(
      "PATCH",
      `/v1/evaluation-items/${sem!.id}`,
      { score: 500 },
      { headers: ifMatch(sem!.version) },
    );
    const linked = await lia.b.request("PUT", `/v1/subjects/${lia.subject.id}/moodle-grades`, {
      links: [
        { evaluationItemId: p1!.id, externalGradeItemId: "gi:900" },
        { evaluationItemId: sem!.id, externalGradeItemId: "gi:901" },
      ],
    });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(moodleGradesSchema.parse(linked.json()).items.map((i) => i.linkedTo)).toEqual([
      p1!.id,
      sem!.id,
    ]);
    const after = subjectGradingSchema.parse(
      (await lia.b.request("GET", `/v1/subjects/${lia.subject.id}/grading`)).json(),
    );
    expect(after.items.map((i) => [i.key, i.score, i.scoreSource, i.externalGradeItemId])).toEqual([
      ["P1", 750, "moodle", "gi:900"],
      ["Seminario", 500, "user", "gi:901"],
    ]);
    const notices = await env.db.admin.query(
      "select 1 from app.notification_logs where user_id = $1 and kind = 'grade_posted'",
      [lia.userId],
    );
    expect(notices.rowCount).toBe(0);

    const bad = await lia.b.request("PUT", `/v1/subjects/${lia.subject.id}/moodle-grades`, {
      links: [{ evaluationItemId: p1!.id, externalGradeItemId: "gi:12345" }],
    });
    expect(bad.statusCode).toBe(422);
    const other = await student();
    const stranger = await other.b.request("GET", `/v1/subjects/${lia.subject.id}/moodle-grades`);
    expect(stranger.statusCode).toBe(404);

    await lia.b.request("PUT", `/v1/subjects/${lia.subject.id}/moodle-grades`, {
      links: [{ evaluationItemId: p1!.id, externalGradeItemId: null }],
    });
    const unlinked = subjectGradingSchema.parse(
      (await lia.b.request("GET", `/v1/subjects/${lia.subject.id}/grading`)).json(),
    );
    expect(unlinked.items[0]).toMatchObject({
      score: 750,
      scoreSource: "user",
      externalGradeItemId: null,
    });

    const exp = await lia.b.request("GET", "/v1/me/export.json");
    expect(exp.statusCode).toBe(200);
    expect(exp.body).not.toContain("SEGREDO-LIA");
    expect(exp.body).not.toContain(WSTOKEN);
    expect(exp.body).not.toMatch(/icsUrlEnc|wstokenEnc|ics_url_enc|wstoken_enc/);
    const data = exp.json<{
      grades: { schemes: unknown[]; evaluations: { key: string; score: number | null }[] };
      moodle: { hasToken: boolean; courses: { courseKey: string }[] } | null;
    }>();
    expect(data.grades.schemes).toHaveLength(1);
    expect(data.grades.evaluations.map((e) => [e.key, e.score])).toEqual([
      ["P1", 750],
      ["Seminario", 500],
    ]);
    expect(data.moodle).toMatchObject({ hasToken: true });
    expect(data.moodle?.courses.map((c) => c.courseKey)).toContain("RED1 - 2026-2");
  });
});
