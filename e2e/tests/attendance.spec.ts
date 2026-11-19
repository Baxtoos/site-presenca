import { expect, test } from "@playwright/test";
import { isoWeekday, realPath, setupStudentWithClassToday, WEEKDAYS } from "./setup-helpers";

test("registra falta, desfaz, corrige e vê o resumo acompanhar", async ({ page }, testInfo) => {
  // Fluxo longo (várias páginas); no `next dev`, cada página nova compila na primeira visita.
  test.slow();
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

  // Na matéria: o calendário já abre no dia de hoje, com a falta parcial marcada.
  await aula.getByRole("link", { name: "Física I" }).click();
  await expect(page.getByRole("heading", { name: "Posso faltar?" })).toBeVisible();
  const calendario = page.getByTestId("calendario");
  const hoje = calendario
    .locator(`[data-estado]`)
    .filter({ hasText: new RegExp(`^${Number(today.slice(8))}`) });
  await expect(hoje).toHaveAttribute("data-estado", "partial");
  await expect(hoje).toHaveAttribute("aria-pressed", "true");
  const dia = page.getByTestId("dia-selecionado");
  await expect(dia).toContainText("Faltei 1 de 2");

  // O histórico (recolhido) mostra o registro; corrigir para presença zera as faltas.
  await page.getByText("Histórico e aula extra").click();
  const registro = page.getByTestId("registro").first();
  await expect(registro).toContainText("Faltei 1 de 2");
  await expect(registro).toContainText("Consulta médica");
  await registro.getByRole("button", { name: /^Editar/ }).click();
  await registro.getByLabel("O que aconteceu").selectOption("present");
  await registro.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Registro atualizado.")).toBeVisible();
  await expect(registro).toContainText("Compareci");
  await expect(page.getByLabel("Resumo de faltas")).toContainText("0 de 18");
  await expect(hoje).toHaveAttribute("data-estado", "present");

  // O filtro de faltas fica vazio.
  await page.getByRole("button", { name: "Faltas", exact: true }).click();
  await expect(page.getByText("Nenhum registro com esse filtro.")).toBeVisible();

  // Pelo calendário: falta no dia → resumo acompanha → apagar o registro volta a "falta marcar".
  await dia.getByRole("button", { name: "Faltei", exact: true }).click();
  await expect(page.getByText("Falta registrada.")).toBeVisible();
  await expect(hoje).toHaveAttribute("data-estado", "absent");
  await expect(page.getByLabel("Resumo de faltas")).toContainText("2 de 18");
  await dia.getByRole("button", { name: "Apagar registro" }).click();
  await expect(page.getByText("Registro apagado.")).toBeVisible();
  await expect(hoje).toHaveAttribute("data-estado", "todo");
  await expect(page.getByLabel("Resumo de faltas")).toContainText("0 de 18");

  // As opções de edição ficam numa página à parte.
  await page.getByRole("link", { name: "Editar matéria" }).click();
  await expect(page.getByRole("heading", { name: "Editar matéria" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Horários na semana" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apagar matéria" })).toBeVisible();
  await page.getByRole("link", { name: "← Física I" }).click();
  await expect(page.getByRole("heading", { name: "Posso faltar?" })).toBeVisible();

  // Nenhuma tela da área logada rola para o lado (nem com e-mail comprido, nem no celular).
  for (const url of [await realPath(page), "/", "/hoje", "/semestres", "/conta"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `rolagem lateral em ${url}`).toBeLessThanOrEqual(0);
    // E a navegação mostra todos os links inteiros (sem rolar dentro dela).
    const navOverflow = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Principal"]')!;
      return nav.scrollWidth - nav.clientWidth;
    });
    expect(navOverflow, `navegação cortada em ${url}`).toBeLessThanOrEqual(0);
  }
});
