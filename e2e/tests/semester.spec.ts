import { expect, test } from "@playwright/test";

const uniqueEmail = (project: string) =>
  `e2e.semestre.${project}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@presenca.local`;

test("configura um semestre real de ponta a ponta pela interface", async ({ page }, testInfo) => {
  // Conta nova.
  await page.goto("/cadastro");
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await page.getByLabel("Nome").fill("Carla Semestre");
  await page.getByLabel("E-mail").fill(uniqueEmail(testInfo.project.name));
  await page.getByLabel("Senha", { exact: true }).fill("senha-forte-do-semestre-e2e");
  await page.getByRole("button", { name: "Criar conta" }).click();

  // Início vazio → criar semestre.
  await expect(page.getByRole("heading", { name: "Comece pelo seu semestre" })).toBeVisible();
  await page.getByRole("link", { name: "Criar meu semestre" }).click();
  await expect(page.getByRole("heading", { name: "Semestres", exact: true })).toBeVisible();
  await page.getByLabel("Nome").fill("2026.2");
  await page.getByLabel("Início das aulas").fill("2026-08-03");
  await page.getByLabel("Fim das aulas").fill("2026-12-18");
  await page.getByRole("button", { name: "Criar semestre" }).click();
  await expect(page.getByRole("heading", { name: /^2026\.2/ })).toBeVisible();

  // Assistente de matéria: a prévia acompanha as regras.
  await page.getByRole("link", { name: "Adicionar matéria" }).click();
  await expect(page.getByRole("heading", { name: "Nova matéria" })).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("Cálculo II");
  await page.getByLabel("Professor(a)").fill("Prof. Andrade");
  const preview = page.getByTestId("previa");
  // Padrão: 60 h, hora-relógio, chamada de 50 min, 75%, 2 tempos por aula.
  await expect(preview).toContainText("18 tempos (9 encontros de 2 tempos)");
  await page.getByLabel("Presença mínima (%)").fill("85");
  await expect(preview).toContainText("10 tempos (5 encontros de 2 tempos)");
  await page.getByLabel("Presença mínima (%)").fill("75");
  await expect(preview).toContainText("18 tempos");

  await page.getByRole("button", { name: "Adicionar horário" }).click();
  await page.getByRole("button", { name: "Adicionar horário" }).click();
  await page.getByRole("button", { name: "Salvar matéria" }).click();

  // Volta ao semestre com o card da matéria.
  await expect(page.getByRole("heading", { name: /^2026\.2/ })).toBeVisible();
  const card = page.getByRole("link", { name: /Cálculo II/ });
  await expect(card).toContainText("0 de 18 faltas");
  await expect(card).toContainText("Seguro");
  await expect(card).toContainText("Seg · Qua");

  // Feriado fora do semestre é recusado no campo; dentro, entra na lista.
  await page.getByLabel("Nome", { exact: true }).fill("Natal");
  await page.getByLabel("Data (ou início)").fill("2026-12-25");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Fica fora do semestre (03/08/2026 a 18/12/2026).")).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill("Finados");
  await page.getByLabel("Data (ou início)").fill("2026-11-02");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Feriado · 02/11/2026")).toBeVisible();

  // O início mostra a matéria do semestre atual.
  await page.getByRole("link", { name: "Início" }).first().click();
  await expect(page.getByRole("heading", { name: "Suas matérias" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cálculo II/ })).toContainText(
    "Ainda pode faltar 18 tempos",
  );
});
