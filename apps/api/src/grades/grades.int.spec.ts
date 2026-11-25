import { randomUUID } from "node:crypto";
import {
  meResponseSchema,
  problemSchema,
  subjectGradingSchema,
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
const ifMatch = (version: number) => ({ "if-match": `"${version}"` });
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());

async function student() {
  const b = new Browser(env.app);
  const reg = await registerAndConfirm(env, b, {
    email: `notas.${Date.now()}.${++seq}@exemplo.com`,
    password: "senha-forte-das-notas-1",
    fullName: "Aluna Notas",
  });
  expect(reg.statusCode).toBe(200);
  meResponseSchema.parse(reg.json());
  const sem = await b.request("POST", "/v1/semesters", {
    label: `N-${++seq}`,
    startsOn: "2026-08-03",
    endsOn: "2026-12-18",
    isCurrent: true,
  });
  const semesterId = sem.json<{ id: string }>().id;
  const mk = async (name: string) =>
    subjectSchema.parse(
      (
        await b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
          name,
          unitsPerClass: 2,
          countingMode: "class_count",
          totalClasses: 36,
          minAttendanceBp: 7500,
        })
      ).json(),
    );
  return { b, calc: await mk("Cálculo"), fis: await mk("Física") };
}

const weighted = {
  rules: { scale: 10, passing: 600, formula: "0.4*P1 + 0.6*P2" },
  items: [
    { key: "P1", name: "Prova 1", maxScore: 1000 },
    { key: "P2", name: "Prova 2", maxScore: 1000, dueOn: "2026-11-27", createTask: true },
  ],
  source: "ai",
};

describe("Notas (/v1/subjects/:id/grading)", () => {
  it("cria a regra, lança nota, mostra garantida/parcial/quanto falta e liga a tarefa", async () => {
    const ana = await student();
    const empty = subjectGradingSchema.parse(
      (await ana.b.request("GET", `/v1/subjects/${ana.calc.id}/grading`)).json(),
    );
    expect(empty).toMatchObject({ scheme: null, items: [], summary: null });

    const saved = await ana.b.request("PUT", `/v1/subjects/${ana.calc.id}/grading`, weighted);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.headers.etag).toBe('"1"');
    const g = subjectGradingSchema.parse(saved.json());
    expect(g.scheme).toMatchObject({ source: "ai", version: 1 });
    expect(g.summary).toMatchObject({
      guaranteed: 0,
      maxPossible: 1000,
      status: "em_curso",
      total: 2,
    });
    const p2 = g.items.find((i) => i.key === "P2")!;
    expect(p2.task).toMatchObject({ title: "Prova 2", status: "pending" });

    // A tarefa criada aparece no calendário, ligada à avaliação.
    const tasks = taskListSchema.parse((await ana.b.request("GET", "/v1/tasks")).json()).tasks;
    expect(tasks.map((t) => [t.title, t.dueLocal, t.evaluation?.name])).toEqual([
      ["Prova 2", { date: "2026-11-27", time: "23:59" }, "Prova 2"],
    ]);

    const p1 = g.items.find((i) => i.key === "P1")!;
    const scored = await ana.b.request(
      "PATCH",
      `/v1/evaluation-items/${p1.id}`,
      { score: 500 },
      { headers: ifMatch(p1.version) },
    );
    expect(scored.statusCode, scored.body).toBe(200);
    const after = subjectGradingSchema.parse(scored.json());
    expect(after.summary).toMatchObject({ guaranteed: 200, partial: 500, maxPossible: 800 });
    // 0,4×5 + 0,6×x ≥ 6 → x ≥ 6,67 (sem arredondar para cima).
    expect(after.summary?.needed?.items).toEqual([
      { key: "P2", name: "Prova 2", needed: 667, maxScore: 1000 },
    ]);
    expect(after.items.find((i) => i.key === "P1")).toMatchObject({
      score: 500,
      scoreSource: "user",
    });

    const tooHigh = await ana.b.request(
      "PATCH",
      `/v1/evaluation-items/${p1.id}`,
      { score: 1100 },
      { headers: ifMatch(p1.version + 1) },
    );
    expect(tooHigh.statusCode).toBe(422);
  });

  it("lançar nota com completeTask conclui a tarefa ligada; a lista de matérias traz a situação", async () => {
    const bia = await student();
    const g = subjectGradingSchema.parse(
      (await bia.b.request("PUT", `/v1/subjects/${bia.calc.id}/grading`, weighted)).json(),
    );
    const p2 = g.items.find((i) => i.key === "P2")!;
    expect(p2.task?.status).toBe("pending");

    const res = await bia.b.request(
      "PATCH",
      `/v1/evaluation-items/${p2.id}`,
      { score: 900, completeTask: true },
      { headers: ifMatch(p2.version) },
    );
    expect(res.statusCode, res.body).toBe(200);
    const after = subjectGradingSchema.parse(res.json());
    expect(after.items.find((i) => i.key === "P2")?.task?.status).toBe("completed");
    const task = taskSchema.parse((await bia.b.request("GET", `/v1/tasks/${p2.task!.id}`)).json());
    expect(task).toMatchObject({
      status: "completed",
      statusSource: "user",
      evaluation: { score: 900 },
    });

    // Sem completeTask a tarefa não muda (P1 não tem tarefa; apagar a nota da P2 não reabre).
    const cleared = await bia.b.request(
      "PATCH",
      `/v1/evaluation-items/${p2.id}`,
      { score: null, completeTask: true },
      { headers: ifMatch(p2.version + 1) },
    );
    expect(
      subjectGradingSchema.parse(cleared.json()).items.find((i) => i.key === "P2")?.task?.status,
    ).toBe("completed");

    const list = (
      await bia.b.request("GET", `/v1/semesters/${bia.calc.semesterId}/subjects`)
    ).json<{
      subjects: unknown[];
    }>();
    const subjects = list.subjects.map((s) => subjectSchema.parse(s));
    expect(subjects.find((s) => s.id === bia.calc.id)?.gradeStatus).toBe("em_curso");
    expect(subjects.find((s) => s.id === bia.fis.id)?.gradeStatus).toBeNull();
  });

  it("valida a regra, exige If-Match ao editar e mantém as notas ao renomear", async () => {
    const bia = await student();
    const bad = await bia.b.request("PUT", `/v1/subjects/${bia.calc.id}/grading`, {
      ...weighted,
      rules: { ...weighted.rules, formula: "0.4*P1 + 0.6*P3" },
    });
    expect(bad.statusCode).toBe(422);
    expect(problem(bad)).toMatchObject({
      code: "GRADING_INVALID",
      errors: [{ path: "formula", message: '"P3" não é uma avaliação nem um grupo.' }],
    });
    const created = subjectGradingSchema.parse(
      (await bia.b.request("PUT", `/v1/subjects/${bia.calc.id}/grading`, weighted)).json(),
    );
    const p1 = created.items.find((i) => i.key === "P1")!;
    await bia.b.request(
      "PATCH",
      `/v1/evaluation-items/${p1.id}`,
      { score: 800 },
      { headers: ifMatch(p1.version) },
    );

    const renamed = {
      rules: { scale: 10, passing: 600, formula: "(Prova1 + Prova2) / 2" },
      items: created.items.map((i) => ({
        id: i.id,
        key: i.key === "P1" ? "Prova1" : "Prova2",
        name: i.name,
        maxScore: i.maxScore,
      })),
    };
    expect(
      (await bia.b.request("PUT", `/v1/subjects/${bia.calc.id}/grading`, renamed)).statusCode,
    ).toBe(428);
    const stale = await bia.b.request("PUT", `/v1/subjects/${bia.calc.id}/grading`, renamed, {
      headers: ifMatch(99),
    });
    expect(stale.statusCode).toBe(412);
    const ok = subjectGradingSchema.parse(
      (
        await bia.b.request("PUT", `/v1/subjects/${bia.calc.id}/grading`, renamed, {
          headers: ifMatch(created.scheme!.version),
        })
      ).json(),
    );
    expect(ok.items.map((i) => [i.key, i.score])).toEqual([
      ["Prova1", 800],
      ["Prova2", null],
    ]);
    expect(ok.summary).toMatchObject({ guaranteed: 400 });
    expect(ok.scheme).toMatchObject({ source: "manual", version: 2 });
  });

  it("tarefa só liga a avaliação da mesma matéria; contas não se misturam", async () => {
    const caio = await student();
    const g = subjectGradingSchema.parse(
      (await caio.b.request("PUT", `/v1/subjects/${caio.calc.id}/grading`, weighted)).json(),
    );
    const p1 = g.items.find((i) => i.key === "P1")!;
    const task = taskSchema.parse(
      (
        await caio.b.request(
          "POST",
          "/v1/tasks",
          { title: "Lista de Física", subjectId: caio.fis.id, dueAt: "2026-11-25T23:59" },
          { headers: { "idempotency-key": randomUUID() } },
        )
      ).json(),
    );
    const wrong = await caio.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { evaluationItemId: p1.id },
      { headers: ifMatch(task.version) },
    );
    expect(wrong.statusCode).toBe(422);
    expect(problem(wrong).errors?.[0]).toMatchObject({
      path: "evaluationItemId",
      message: "A avaliação precisa ser da mesma matéria da tarefa.",
    });
    const right = await caio.b.request(
      "PATCH",
      `/v1/tasks/${task.id}`,
      { subjectId: caio.calc.id, evaluationItemId: p1.id },
      { headers: ifMatch(task.version) },
    );
    expect(right.statusCode, right.body).toBe(200);
    expect(taskSchema.parse(right.json()).evaluation).toMatchObject({
      name: "Prova 1",
      score: null,
    });

    const dani = await student();
    expect((await dani.b.request("GET", `/v1/subjects/${caio.calc.id}/grading`)).statusCode).toBe(
      404,
    );
    const steal = await dani.b.request(
      "PATCH",
      `/v1/evaluation-items/${p1.id}`,
      { score: 0 },
      { headers: ifMatch(1) },
    );
    expect(steal.statusCode).toBe(404);
  });
});

describe("Assistente de IA (/v1/subjects/:id/grading/assistant)", () => {
  const scheme = {
    scale: 10,
    passing: 6,
    formula: "0.4*P1 + 0.6*P2",
    groups: [],
    exam: null,
    substitute: null,
    roundingStep: 0,
    items: [
      { key: "P1", name: "Prova 1", maxScore: 10, group: null, role: "regular" },
      { key: "P2", name: "Prova 2", maxScore: 10, group: null, role: "regular" },
    ],
  };
  const ask = (b: Browser, subjectId: string, conversationId: string, texts: string[]) =>
    b.request("POST", `/v1/subjects/${subjectId}/grading/assistant`, {
      conversationId,
      messages: texts.map((text, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text })),
    });

  it("pergunta, depois devolve a regra em centésimos para conferir (sem salvar)", async () => {
    const eva = await student();
    const conv = randomUUID();
    env.ai.queue.push(
      {
        kind: "question",
        question: "Qual a nota mínima para passar?",
        summary: null,
        scheme: null,
      },
      { kind: "scheme", question: null, summary: "P1 vale 40% e P2 60%; passa com 6.", scheme },
    );
    const q = await ask(eva.b, eva.calc.id, conv, ["Duas provas, P1 vale 40% e P2 60%"]);
    expect(q.statusCode, q.body).toBe(200);
    expect(q.json()).toEqual({
      type: "question",
      text: "Qual a nota mínima para passar?",
      remaining: 9,
    });
    const s = await ask(eva.b, eva.calc.id, conv, [
      "Duas provas, P1 vale 40% e P2 60%",
      "Qual a nota mínima para passar?",
      "6",
    ]);
    const body = s.json<{
      type: string;
      proposal: { rules: { passing: number }; items: { maxScore: number }[] };
    }>();
    expect(body).toMatchObject({ type: "scheme", remaining: 8 });
    expect(body.proposal.rules.passing).toBe(600);
    expect(body.proposal.items.map((i) => i.maxScore)).toEqual([1000, 1000]);
    // Nada foi salvo: o aluno confere e salva pelo PUT.
    const g = subjectGradingSchema.parse(
      (await eva.b.request("GET", `/v1/subjects/${eva.calc.id}/grading`)).json(),
    );
    expect(g).toMatchObject({ scheme: null, assistantAvailable: true });
    // A matéria e o limite de perguntas vão no pedido à IA.
    expect(env.ai.calls.at(-1)?.system).toContain("Matéria: Cálculo.");
    expect(env.ai.calls.at(-1)?.system).toContain(
      "Perguntas que ainda pode fazer nesta conversa: 8.",
    );
  });

  it("regra com problema: pede conserto uma vez; erro ou recusa da IA cai no editor manual", async () => {
    const fred = await student();
    env.ai.queue.push(
      {
        kind: "scheme",
        question: null,
        summary: "x",
        scheme: { ...scheme, formula: "0.4*P1 + 0.6*P9" },
      },
      { kind: "scheme", question: null, summary: "Corrigido.", scheme },
    );
    const fixed = await ask(fred.b, fred.calc.id, randomUUID(), ["Duas provas"]);
    expect(fixed.json()).toMatchObject({ type: "scheme", summary: "Corrigido." });
    expect(String(env.ai.calls.at(-1)?.messages.at(-1)?.content)).toContain(
      '"P9" não é uma avaliação',
    );

    env.ai.queue.push(new Error("timeout"));
    expect((await ask(fred.b, fred.calc.id, randomUUID(), ["Oi"])).json()).toMatchObject({
      type: "fallback",
      reason: "error",
    });
    env.ai.queue.push({ refusal: true });
    expect((await ask(fred.b, fred.calc.id, randomUUID(), ["Oi"])).json()).toMatchObject({
      type: "fallback",
      reason: "error",
    });
  });

  it("no máximo 10 chamadas por conversa; depois, editor manual", async () => {
    const gabi = await student();
    const conv = randomUUID();
    for (let i = 0; i < 10; i++) {
      env.ai.queue.push({
        kind: "question",
        question: `Pergunta ${i + 1}?`,
        summary: null,
        scheme: null,
      });
    }
    let last: unknown;
    for (let i = 0; i < 10; i++) last = (await ask(gabi.b, gabi.calc.id, conv, ["Não sei"])).json();
    // Na 10ª, sem perguntas restantes, a IA não pode mais perguntar: vai para o editor.
    expect(last).toMatchObject({ type: "fallback", reason: "limit" });
    const over = await ask(gabi.b, gabi.calc.id, conv, ["Não sei"]);
    expect(over.json()).toMatchObject({ type: "fallback", reason: "limit" });
    expect(env.ai.queue).toHaveLength(0); // a 11ª nem chegou à IA
  });
});
