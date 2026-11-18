import { expect, test } from "@playwright/test";

const WEEKDAYS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** Hoje no fuso do aluno (o padrão da conta é America/Sao_Paulo), como "AAAA-MM-DD". */
function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

test("registra falta, desfaz, corrige e vê o resumo acompanhar", async ({ page }, testInfo) => {
  const today = todayInSaoPaulo();

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Davi Presença");
  await page
    .getByLabel("E-mail")
    .fill(
      `e2e.presenca.${testInfo.project.name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@presenca.local`,
    );
  await page.getByLabel("Senha", { exact: true }).fill("senha-forte-da-presenca-e2e");
  await page.getByRole("button", { name: "Criar conta" }).click();

  // Semestre em volta de hoje, com uma aula de 2 tempos no dia da semana de hoje.
  await page.getByRole("link", { name: "Criar meu semestre" }).click();
  await expect(page.getByRole("heading", { name: "Semestres", exact: true })).toBeVisible();
  await page.getByLabel("Nome").fill("Atual");
  await page.getByLabel("Início das aulas").fill(shift(today, -60));
  await page.getByLabel("Fim das aulas").fill(shift(today, 60));
  await page.getByRole("button", { name: "Criar semestre" }).click();
  await expect(page.getByRole("heading", { name: /^Atual/ })).toBeVisible();
  await page.getByRole("link", { name: "Adicionar matéria" }).click();
  await expect(page.getByRole("heading", { name: "Nova matéria" })).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("Física I");
  await page.getByRole("button", { name: "Adicionar horário" }).click();
  await page.getByLabel("Dia").selectOption(String(isoWeekday(today)));
  await page.getByRole("button", { name: "Salvar matéria" }).click();
  await expect(page.getByRole("link", { name: /Física I/ })).toBeVisible();

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
