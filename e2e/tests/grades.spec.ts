import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { setupStudentWithClassToday } from "./setup-helpers";

test("notas: montar a regra no editor, lançar nota, ver quanto falta e simular", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await setupStudentWithClassToday(page, testInfo, {
    name: "Nina Notas",
    slug: "notas",
    subject: "Cálculo",
  });
  await page
    .getByRole("main")
    .getByRole("link", { name: /Cálculo/ })
    .first()
    .click();
  const notes = page.getByRole("region", { name: "Notas" });
  await expect(notes).toBeVisible();

  // Sem chave da IA no teste: o editor aparece sozinho, com P1 e P2 e média simples.
  await expect(notes.getByTestId("assistente-notas")).toHaveCount(0);
  await expect(notes.getByLabel("Fórmula", { exact: true })).toHaveValue("(P1 + P2) / 2");
  await notes.getByRole("button", { name: "Salvar regra" }).click();
  await expect(page.getByText("Regra de cálculo salva.")).toBeVisible();

  // O motor faz as contas: 4 na P1 → precisa de 8 na P2 para chegar a 6.
  const summary = notes.getByTestId("resumo-notas");
  await expect(summary.getByTestId("situacao-nota")).toHaveText("Em curso");
  await notes.getByLabel(/^Prova 1/).fill("4");
  await notes
    .getByTestId("avaliacao")
    .filter({ hasText: "Prova 1" })
    .getByRole("button", { name: "Lançar nota" })
    .click();
  await expect(page.getByText("Nota de Prova 1 lançada.")).toBeVisible();
  await expect(summary.getByTestId("quanto-falta")).toContainText("8 na Prova 2");

  // Simulação no navegador: 9 na P2 aprova (nada é salvo).
  await notes.getByLabel("E se eu tirar").fill("9");
  await expect(summary.getByTestId("situacao-nota")).toHaveText("Aprovado por nota");
  await expect(summary.getByText("Simulação: nada foi salvo.")).toBeVisible();
  await notes.getByRole("button", { name: "Limpar simulação" }).click();
  await expect(summary.getByTestId("situacao-nota")).toHaveText("Em curso");

  // Aba Notas: todas as matérias, com a situação e quanto falta.
  await page.getByRole("link", { name: "Notas", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Notas", exact: true })).toBeVisible();
  const card = page.getByTestId("nota-materia").filter({ hasText: "Cálculo" });
  await expect(card).toContainText("Em curso");
  await expect(card).toContainText("1 de 2 notas lançadas");
  await expect(card).toContainText("8 na Prova 2");
  await card.click();
  await expect(notes.getByTestId("resumo-notas")).toBeVisible();
  await page.getByRole("link", { name: "Notas", exact: true }).first().click();
  await expect(card).toBeVisible();

  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`),
  ).toEqual([]);
});
