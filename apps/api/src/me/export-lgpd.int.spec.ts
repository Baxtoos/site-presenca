import { randomUUID } from "node:crypto";
import { meResponseSchema, subjectSchema } from "@presenca/contracts";
import ExcelJS from "exceljs";
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
const key = () => ({ headers: { "idempotency-key": randomUUID() } });

async function student(name = "Ana Ribeiro") {
  const b = new Browser(env.app);
  const email = `lgpd.${Date.now()}.${++seq}@exemplo.com`;
  const password = "senha-forte-exportacao-1";
  const reg = await registerAndConfirm(env, b, {
    email,
    password,
    fullName: name,
  });
  expect(reg.statusCode).toBe(200);
  const userId = meResponseSchema.parse(reg.json()).id;
  return { b, userId, email, password };
}

describe("Fase 8: exportação Excel (.xlsx) e direitos LGPD (export.json e exclusão de conta)", () => {
  it("gera planilha .xlsx com 3 abas, fórmulas gravadas, valores pré-calculados e formatos", async () => {
    const ana = await student("Ana Ribeiro");
    await ana.b.request("PATCH", "/v1/me", {
      institution: "Universidade Exemplo",
      course: "Engenharia de Computação",
    });

    const sem = await ana.b.request("POST", "/v1/semesters", {
      label: "2026.1",
      startsOn: "2026-03-02",
      endsOn: "2026-07-10",
      isCurrent: true,
    });
    expect(sem.statusCode).toBe(201);
    const semesterId = sem.json<{ id: string }>().id;

    // Matéria 1: carga horária (60h, tempo 50min, 75% → 72 tempos, limite 18)
    const calc = subjectSchema.parse(
      (
        await ana.b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
          name: "Cálculo II",
          professor: "Prof. Andrade",
          color: "blue",
          unitsPerClass: 2,
          countingMode: "workload",
          workloadHours: 60,
          workloadHourMinutes: 60,
          unitMinutes: 50,
          minAttendanceBp: 7500,
          excusedPolicy: "track_only",
          schedules: [
            {
              weekday: 1,
              startsAt: "19:00",
              endsAt: "20:40",
              units: 2,
              room: "B-204",
              building: "Bloco B",
            },
          ],
        })
      ).json(),
    );

    // Matéria 2: limite manual (4 tempos), com atestado que desconta do limite
    const lab = subjectSchema.parse(
      (
        await ana.b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
          name: "Laboratório de Redes",
          professor: "Profa. Lima",
          color: "teal",
          unitsPerClass: 2,
          countingMode: "manual",
          manualMaxUnits: 4,
          totalClasses: 20,
          excusedPolicy: "deduct",
          schedules: [{ weekday: 3, startsAt: "21:00", endsAt: "22:40", units: 2, room: "Lab 3" }],
        })
      ).json(),
    );

    // Registros de falta
    const att1 = await ana.b.request(
      "POST",
      "/v1/attendance",
      {
        subjectId: calc.id,
        classDate: "2026-03-09",
        status: "absent",
        unitsScheduled: 2,
        isExcused: false,
        reason: "transport",
        note: "Ônibus atrasou",
      },
      key(),
    );
    expect(att1.statusCode).toBe(201);
    const att2 = await ana.b.request(
      "POST",
      "/v1/attendance",
      {
        subjectId: calc.id,
        classDate: "2026-03-16",
        status: "absent",
        unitsScheduled: 2,
        isExcused: true,
        reason: "health",
        note: "Atestado médico",
      },
      key(),
    );
    expect(att2.statusCode).toBe(201);
    const att3 = await ana.b.request(
      "POST",
      "/v1/attendance",
      {
        subjectId: lab.id,
        classDate: "2026-03-11",
        status: "absent",
        unitsScheduled: 2,
        isExcused: true,
        reason: "health",
      },
      key(),
    );
    expect(att3.statusCode).toBe(201);

    const res = await ana.b.request("GET", `/v1/semesters/${semesterId}/export.xlsx`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers["content-disposition"]).toContain('filename="presenca_2026-1.xlsx"');

    // Reabre com ExcelJS e confere abas, fórmulas e resultados pré-calculados
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);

    const sheetNames = wb.worksheets.map((w) => w.name);
    // "Dados" fica muito oculta: guarda tudo para a importação (o aluno não vê nem reexibe no Excel).
    expect(sheetNames).toEqual(["Resumo", "Historico", "Grade Horária", "Dados"]);
    expect(wb.getWorksheet("Dados")!.state).toBe("veryHidden");

    const resumo = wb.getWorksheet("Resumo")!;
    expect(resumo.getCell("A1").value).toBe("Relatório de Frequência · 2026.1");
    expect(resumo.getCell("A2").text).toContain("Ana Ribeiro · Engenharia de Computação");

    // Linha 5: Cálculo II (ordem alfabética)
    expect(resumo.getCell("A5").value).toBe("Cálculo II");
    expect(resumo.getCell("D5").value).toBe(72);
    expect(resumo.getCell("F5").value).toEqual({
      formula: 'SUMIFS(Historico!D:D, Historico!C:C, A5, Historico!F:F, "Contabilizada*")',
      result: 4,
    });
    expect(resumo.getCell("H5").value).toEqual({
      formula: "ROUNDDOWN(ROUND(M5*(1-E5)/N5, 6), 0)",
      result: 18,
    });
    expect(resumo.getCell("I5").value).toEqual({
      formula: "H5-F5",
      result: 14,
    });
    expect(resumo.getCell("J5").numFmt).toBe("0.0%");
    expect(resumo.getCell("L5").value).toEqual({
      formula:
        'IF(F5>H5,"Reprovado",IF(F5=H5,"Limite atingido",IF(K5>=0.75,"Crítico",IF(K5>=0.5,"Atenção","Seguro"))))',
      result: "Seguro",
    });

    // Linha 6: Laboratório de Redes (limite manual vira valor fixo com nota; falta abonada em G6 = 2)
    expect(resumo.getCell("A6").value).toBe("Laboratório de Redes");
    expect(resumo.getCell("H6").value).toBe(4);
    expect(resumo.getCell("G6").value).toEqual({
      formula: 'SUMIFS(Historico!D:D, Historico!C:C, A6, Historico!F:F, "Abonada")',
      result: 2,
    });

    // Aba 2: Historico
    const historico = wb.getWorksheet("Historico")!;
    expect(historico.getCell("A2").value).toBeInstanceOf(Date);
    expect(historico.getCell("A2").numFmt).toBe("dd/mm/yyyy");
    expect(historico.getCell("F2").value).toBe("Contabilizada");
    expect(historico.getCell("F3").value).toBe("Abonada");
    expect(historico.getCell("F4").value).toBe("Contabilizada · atestado");

    // Aba 3: Grade Horária
    const grade = wb.getWorksheet("Grade Horária")!;
    expect(grade.getCell("A2").value).toBe("19:00 – 20:40");
    expect(grade.getCell("B2").text).toContain("Cálculo II");

    // Isolamento: outro usuário recebe 404
    const outro = await student("Outro Aluno");
    const forbidden = await outro.b.request("GET", `/v1/semesters/${semesterId}/export.xlsx`);
    expect(forbidden.statusCode).toBe(404);
  });

  it("exporta todos os dados do aluno em JSON (GET /v1/me/export.json) e exclui a conta (DELETE /v1/me) apagando auditoria", async () => {
    const dono = await student("Dono da Conta");
    const colega = await student("Colega Importador");

    const sem = await dono.b.request("POST", "/v1/semesters", {
      label: "2026.1",
      startsOn: "2026-03-02",
      endsOn: "2026-07-10",
      isCurrent: true,
    });
    const semesterId = sem.json<{ id: string }>().id;

    const subj = subjectSchema.parse(
      (
        await dono.b.request("POST", `/v1/semesters/${semesterId}/subjects`, {
          name: "Algoritmos",
          unitsPerClass: 2,
          countingMode: "class_count",
          totalClasses: 36,
          minAttendanceBp: 7500,
          schedules: [{ weekday: 2, startsAt: "08:00", endsAt: "09:40", units: 2 }],
        })
      ).json(),
    );

    await dono.b.request(
      "POST",
      "/v1/attendance",
      {
        subjectId: subj.id,
        classDate: "2026-03-10",
        status: "absent",
        unitsScheduled: 2,
      },
      key(),
    );

    // Tarefa ligada a uma avaliação e regra de notas: também saem no export e somem na exclusão.
    const grading = await dono.b.request("PUT", `/v1/subjects/${subj.id}/grading`, {
      rules: { scale: 10, passing: 600, formula: "P1" },
      items: [
        { key: "P1", name: "Prova 1", maxScore: 1000, dueOn: "2026-04-01", createTask: true },
      ],
      source: "manual",
    });
    expect(grading.statusCode, grading.body).toBe(200);

    // Compartilha a grade e o colega importa (testa cascata de FK entre usuários ao excluir o dono)
    const tpl = await dono.b.request("POST", "/v1/templates", {
      source: { kind: "semester", semesterId },
      title: "Grade 2026.1",
    });
    expect(tpl.statusCode).toBe(201);
    const code = tpl.json<{ code: string }>().code;

    const imp = await colega.b.request(
      "POST",
      `/v1/templates/${code}/import`,
      { label: "2026.1 Importado" },
      key(),
    );
    expect(imp.statusCode).toBe(201);

    // 1. Exportação JSON (LGPD)
    const exp = await dono.b.request("GET", "/v1/me/export.json");
    expect(exp.statusCode).toBe(200);
    expect(exp.headers["content-disposition"]).toContain('filename="meus-dados-presenca.json"');
    const payload = exp.json<{
      user: { id: string; email: string };
      semesters: unknown[];
      subjects: unknown[];
      attendanceLogs: unknown[];
      auditEvents: unknown[];
      sharedTemplates: unknown[];
    }>();
    expect(payload.user.id).toBe(dono.userId);
    expect(payload.semesters).toHaveLength(1);
    expect(payload.subjects).toHaveLength(1);
    expect(payload.attendanceLogs).toHaveLength(1);
    expect(payload.auditEvents.length).toBeGreaterThanOrEqual(1);
    expect(payload.sharedTemplates).toHaveLength(1);
    expect(exp.json<{ tasks: unknown[] }>().tasks).toHaveLength(1);
    expect(
      exp.json<{ grades: { schemes: unknown[]; evaluations: unknown[] } }>().grades,
    ).toMatchObject({ schemes: [expect.anything()], evaluations: [expect.anything()] });

    // Acesso e segurança: sessões (com IP e navegador) sim; segredos nunca.
    const raw = JSON.stringify(exp.json());
    const { security } = exp.json<{ security: { sessions: unknown[]; twoFactor: unknown } }>();
    expect(security.sessions.length).toBeGreaterThanOrEqual(1);
    expect(security.twoFactor).toBeNull();
    for (const secret of [
      "tokenHash",
      "token_hash",
      "passwordHash",
      "p256dh",
      "secretCiphertext",
      "codeHash",
    ]) {
      expect(raw).not.toContain(secret);
    }

    // 2. Tentativa de exclusão com senha errada falha com 401
    const badDel = await dono.b.request("DELETE", "/v1/me", {
      password: "senha-errada-12345",
    });
    expect(badDel.statusCode).toBe(401);

    // 3. Exclusão com senha certa apaga tudo do usuário (inclusive trilha de auditoria)
    const okDel = await dono.b.request("DELETE", "/v1/me", {
      password: dono.password,
    });
    expect(okDel.statusCode).toBe(204);

    // Sessão encerrada
    const afterMe = await dono.b.request("GET", "/v1/me");
    expect(afterMe.statusCode).toBe(401);

    // Nada restou no banco para o usuário excluído (nem eventos de auditoria)
    const counts = await env.db.admin.query<{
      users: string;
      logs: string;
      events: string;
    }>(
      `select
         (select count(*) from app.users where id = $1) as users,
         (select count(*) from app.attendance_logs where user_id = $1) as logs,
         (select count(*) from app.attendance_log_events where user_id = $1) as events`,
      [dono.userId],
    );
    expect(counts.rows[0]).toEqual({ users: "0", logs: "0", events: "0" });
    // Varre toda tabela com user_id (inclusive as que vierem depois): nenhuma linha pode sobrar.
    const tables = await env.db.admin.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'app' and column_name = 'user_id'
          and table_name in (select table_name from information_schema.tables
                              where table_schema = 'app' and table_type = 'BASE TABLE')`,
    );
    expect(tables.rows.length).toBeGreaterThan(15);
    const left: string[] = [];
    for (const { table_name } of tables.rows) {
      const r = await env.db.admin.query<{ n: string }>(
        `select count(*) as n from app.${table_name} where user_id = $1`,
        [dono.userId],
      );
      if (r.rows[0]!.n !== "0") left.push(`${table_name}: ${r.rows[0]!.n}`);
    }
    expect(left).toEqual([]);

    // O colega que importou a grade continua com o semestre e a matéria intactos
    const colegaSems = await colega.b.request("GET", "/v1/semesters");
    expect(colegaSems.statusCode).toBe(200);
    expect(colegaSems.json<{ semesters: unknown[] }>().semesters).toHaveLength(1);
  });
});
