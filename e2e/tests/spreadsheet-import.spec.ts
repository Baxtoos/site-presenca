import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectPath, setupStudentWithClassToday } from "./setup-helpers";

test("exporta a planilha do semestre e importa de volta, já configurado", async ({
  page,
}, testInfo) => {
  const today = await setupStudentWithClassToday(page, testInfo, {
    name: "Paula Planilha",
    slug: "planilha",
    subject: "Estatística",
  });

  // Uma falta hoje (pela API, com a sessão desta página).
  const origin = new URL(page.url()).origin;
  const { semesters } = (await (await page.request.get("/api/v1/semesters")).json()) as {
    semesters: { id: string }[];
  };
  const { subjects } = (await (
    await page.request.get(`/api/v1/semesters/${semesters[0]!.id}/subjects`)
  ).json()) as { subjects: { id: string; schedules: { id: string }[] }[] };
  const absence = await page.request.post("/api/v1/attendance", {
    headers: { origin, "idempotency-key": crypto.randomUUID() },
    data: {
      subjectId: subjects[0]!.id,
      scheduleId: subjects[0]!.schedules[0]!.id,
      classDate: today,
      status: "absent",
      reason: "health",
    },
  });
  expect(absence.status()).toBe(201);
  await page.reload();
  const card = page.getByRole("main").getByRole("link", { name: /Estatística/ });
  await expect(card).toContainText("2 de 18 faltas");

  // Exporta.
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar Excel (.xlsx)" }).click();
  const file = testInfo.outputPath("semestre.xlsx");
  await (await downloading).saveAs(file);

  // Importa pela tela de Semestres.
  await page.goto("/semestres");
  await page.getByRole("link", { name: "Importar planilha (.xlsx)" }).click();
  await expect(page.getByRole("heading", { name: "Importar planilha" })).toBeVisible();
  // Conteúdo em vez do caminho: o caminho tem acentos (vem do título do teste) e o Chromium
  // daqui não anexa arquivo de caminho assim.
  await page.locator("input#planilha").setInputFiles({
    name: "semestre.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(file),
  });
  await expect(page.getByText("Planilha completa")).toBeVisible();
  await expect(page.getByTestId("resumo-importacao")).toContainText("1 matéria · 1 falta");
  await expect(page.getByTestId("materia-planilha")).toContainText("Estatística");
  await page.getByLabel("Nome do semestre").fill("Cópia importada");
  await page.getByRole("button", { name: "Importar semestre" }).click();

  // Cai no semestre novo, com a matéria e a falta.
  await expect(page.getByRole("heading", { name: /^Cópia importada/ })).toBeVisible();
  await expectPath(page, /^\/semestres\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("main").getByRole("link", { name: /Estatística/ })).toContainText(
    "2 de 18 faltas",
  );

  // Arquivo que não é do app: mensagem clara, nada é enviado.
  await page.goto("/semestres/importar");
  await page.locator("input#planilha").setInputFiles({
    name: "notas.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("isto não é uma planilha"),
  });
  await expect(page.getByText(/precisa ser uma planilha \.xlsx/)).toBeVisible();
});

test("importa a planilha que o aluno fazia sozinho (CSV), sem perder registros", async ({
  page,
}, testInfo) => {
  await setupStudentWithClassToday(page, testInfo, {
    name: "Rita Planilha Própria",
    slug: "planilha-propria",
    subject: "Qualquer",
  });
  await page.goto("/semestres/importar");
  await page.locator("input#planilha").setInputFiles({
    name: "minhas-faltas.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Data;Matéria;Situação;Obs",
        "02/03/2026;Cálculo II;P;",
        "04/03/2026;Cálculo II;F;ônibus atrasou",
        "09/03/2026;Cálculo II;F;",
        "06/03/2026;Física;X;",
        "13/03/2026;Física;X;",
      ].join("\r\n"),
    ),
  });

  // Entendeu o formato; "X" é ambíguo e pede escolha.
  await expect(page.getByTestId("formato-aba")).toContainText("Uma linha por aula · 5 registros");
  await expect(page.getByText("Diga o que significa cada marcação")).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar semestre" })).toBeDisabled();
  await page.getByLabel(/“x”/).selectOption("absent");

  // Dias detectados pelos registros; falta o horário.
  await expect(page.getByTestId("materia-propria")).toHaveCount(2);
  await expect(page.getByText(/Cálculo II: informe o horário/)).toBeVisible();
  for (const i of [0, 1]) {
    await page.locator(`#materia-${i}-inicio`).fill("19:00");
    await page.locator(`#materia-${i}-fim`).fill("20:40");
  }
  await expect(page.getByTestId("resumo-importacao")).toContainText(
    "2 matérias · 4 faltas · 1 presença",
  );

  // A leitura guiada também é acessível.
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);

  await page.getByRole("button", { name: "Importar semestre" }).click();
  await expect(page.getByRole("heading", { name: /^2026\.1/ })).toBeVisible();
  await expectPath(page, /^\/semestres\/[0-9a-f-]{36}$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: /Cálculo II/ })).toContainText("4 de 18 faltas");
  await expect(main.getByRole("link", { name: /Física/ })).toContainText("4 de 18 faltas");
  await expect(main.getByRole("link", { name: /Cálculo II/ })).toContainText("Seg · Qua");
});
