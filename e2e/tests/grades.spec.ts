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

  await expect(notes.getByTestId("assistente-notas")).toHaveCount(0);
  await expect(notes.getByLabel("Fórmula", { exact: true })).toHaveValue("(P1 + P2) / 2");
  await notes.getByRole("button", { name: "Salvar regra" }).click();
  await expect(page.getByText("Regra de cálculo salva.")).toBeVisible();

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

  await notes.getByLabel("E se eu tirar").fill("9");
  await expect(summary.getByTestId("situacao-nota")).toHaveText("Aprovado por nota");
  await expect(summary.getByText("Simulação: nada foi salvo.")).toBeVisible();
  await notes.getByRole("button", { name: "Limpar simulação" }).click();
  await expect(summary.getByTestId("situacao-nota")).toHaveText("Em curso");

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

  await page.goto("/tarefas/nova?voltar=/tarefas");
  await page.getByLabel("Título").fill("Prova 2 de Cálculo");
  await page.getByLabel("Matéria (opcional)").selectOption({ label: "Cálculo" });
  await page.getByLabel(/Avaliação \(opcional\)/).selectOption({ label: "Prova 2" });
  await page.getByLabel("Hora do prazo").fill("23:59");
  await page.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(page.getByText("Tarefa criada.")).toBeVisible();
  const linked = page.getByTestId("tarefa").filter({ hasText: "Prova 2 de Cálculo" });
  await linked.getByRole("button", { name: "Concluída", exact: true }).click();
  await expect(page.getByText("Tarefa marcada como concluída.")).toBeVisible();
  await page.getByRole("link", { name: "Concluídas", exact: true }).click();
  await expect(linked.getByTestId("nota-da-tarefa")).toContainText("Entregue · aguardando nota");
  await linked.getByRole("link", { name: "Lançar nota" }).click();
  await notes.getByLabel(/^Prova 2/).fill("9");
  await notes
    .getByTestId("avaliacao")
    .filter({ hasText: "Prova 2" })
    .getByRole("button", { name: "Lançar nota" })
    .click();
  await expect(page.getByText("Nota de Prova 2 lançada.")).toBeVisible();
  await expect(page.getByTestId("selo-nota").first()).toContainText("Aprovado por nota");
  const evolution = page.getByRole("region", { name: "Evolução no semestre" });
  await expect(evolution.getByRole("figure", { name: "Nota ao longo do semestre" })).toBeVisible();
  await page.reload();
  await evolution.getByText("Ver em tabela").last().click();
  await expect(evolution.getByRole("table", { name: "Nota ao longo do semestre" })).toContainText(
    "6,5",
  );
  await page.goto("/tarefas?status=completed");
  await expect(linked.getByTestId("nota-da-tarefa")).toContainText("nota 9 de 10");
  await page.goto("/");
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: /Cálculo/ })
      .getByTestId("selo-nota"),
  ).toContainText("Aprovado por nota");

  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`),
  ).toEqual([]);
});
