import { expect, test } from "@playwright/test";
import { isoWeekday, setupStudentWithClassToday, WEEKDAYS } from "./setup-helpers";

test("registra falta, desfaz, corrige e vê o resumo acompanhar", async ({ page }, testInfo) => {
  const today = await setupStudentWithClassToday(page, testInfo, {
    name: "Davi Presença",
    slug: "presenca",
    subject: "Física I",
  });

  // Aulas de hoje.
  await page.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`^${WEEKDAYS[isoWeekday(today)]}`) }),
  ).toBeVisible();
  const aula = page.getByTestId("aula").filter({ hasText: "Física I" });
  await expect(aula).toContainText("pode faltar mais 18 tempos");

  // Falta → aviso com Desfazer → volta ao que era.
  await aula.getByRole("button", { name: "Faltei", exact: true }).click();
  await expect(page.getByText("Falta registrada em Física I.")).toBeVisible();
  await expect(aula).toContainText("pode faltar mais 16 tempos");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Desfeito.")).toBeVisible();
  await expect(aula).toContainText("pode faltar mais 18 tempos");
  await expect(aula.getByRole("button", { name: "Faltei", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Parcial de uma aula de 2 tempos: perde 1, sem perguntar.
  await aula.getByRole("button", { name: "Faltei parcial" }).click();
  await expect(aula).toContainText("Faltei 1 de 2");
  await expect(aula).toContainText("pode faltar mais 17 tempos");

  // Motivo e atestado.
  await aula.getByRole("button", { name: "Motivo e atestado" }).click();
  await aula.getByLabel("Motivo").selectOption("health");
  await aula.getByLabel("Observação").fill("Consulta médica");
  await aula.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Detalhes salvos.")).toBeVisible();
  await expect(aula).toContainText("Saúde");

  // Na matéria: o histórico mostra o registro; corrigir para presença zera as faltas.
  await aula.getByRole("link", { name: "Física I" }).click();
  await expect(page.getByRole("heading", { name: "Posso faltar?" })).toBeVisible();
  const registro = page.getByTestId("registro").first();
  await expect(registro).toContainText("Faltei 1 de 2");
  await expect(registro).toContainText("Consulta médica");
  await registro.getByRole("button", { name: /^Editar/ }).click();
  await registro.getByLabel("O que aconteceu").selectOption("present");
  await registro.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Registro atualizado.")).toBeVisible();
  await expect(registro).toContainText("Compareci");
  await expect(page.getByLabel("Resumo de faltas")).toContainText("0 de 18");

  // O filtro de faltas fica vazio.
  await page.getByRole("button", { name: "Faltas", exact: true }).click();
  await expect(page.getByText("Nenhum registro com esse filtro.")).toBeVisible();

  // Nenhuma tela da área logada rola para o lado (nem com e-mail comprido, nem no celular).
  for (const url of [page.url(), "/", "/hoje", "/semestres", "/conta"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `rolagem lateral em ${url}`).toBeLessThanOrEqual(0);
  }
});
