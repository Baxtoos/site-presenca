import { readFileSync } from "node:fs";
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
