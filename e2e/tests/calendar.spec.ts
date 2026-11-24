import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { expectPath, setupStudentWithClassToday, shift, todayInSaoPaulo } from "./setup-helpers";

async function newTaskFromCalendar(
  page: Page,
  task: { title: string; date: string; time: string; subject?: string },
) {
  await page.getByRole("link", { name: "Nova tarefa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible();
  await page.getByLabel("Título").fill(task.title);
  if (task.subject) {
    await page.getByLabel("Matéria (opcional)").selectOption({ label: task.subject });
  }
  await page.getByLabel("Data do prazo").fill(task.date);
  await page.getByLabel("Hora do prazo").fill(task.time);
  await page.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(page.getByText("Tarefa criada.").last()).toBeVisible();
  // Volta para o calendário, não para a lista.
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
}

test("calendário: linha do tempo com filtros, troca de mês e marcar tarefa pelo dia", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await setupStudentWithClassToday(page, testInfo, {
    name: "Carla Calendário",
    slug: "calendario",
    subject: "Banco de Dados",
  });
  const today = todayInSaoPaulo();
  const inTwo = shift(today, 2);
  const inTen = shift(today, 10);

  await page.goto("/");
  await page.getByRole("link", { name: "Calendário" }).first().click();
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  const timeline = page.getByRole("region", { name: "Linha do tempo" });
  await expect(timeline.getByText("Nenhuma tarefa pendente nesta janela.")).toBeVisible();

  await newTaskFromCalendar(page, {
    title: "Prova parcial",
    subject: "Banco de Dados",
    date: inTwo,
    time: "22:00",
  });
  await newTaskFromCalendar(page, { title: "Seminário", date: inTen, time: "23:59" });
  await newTaskFromCalendar(page, {
    title: "Resumo atrasado",
    date: shift(today, -1),
    time: "18:00",
  });

  // Padrão: próximos 7 dias, pendentes. A vencida não aparece, mas o alerta leva até ela.
  const rows = timeline.getByTestId("linha-tarefa");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Prova parcial");
  await expect(rows.first()).toContainText("22:00");
  await expect(rows.first()).toContainText("Pendente · Banco de Dados");
  await expect(timeline.getByText("1 tarefa passou do prazo")).toBeVisible();
  await timeline.getByRole("link", { name: "Ver atrasadas" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Resumo atrasado");
  await expect(rows.first()).toHaveAttribute("data-status", "overdue");

  await timeline.getByRole("link", { name: "Próximos 30 dias" }).click();
  await expect(rows).toHaveCount(2);

  // Busca e agrupamento, sem recarregar.
  await timeline.getByLabel("Buscar").fill("semin");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Seminário");
  await timeline.getByLabel("Buscar").fill("");
  await timeline.getByRole("button", { name: "Agrupar por matéria" }).click();
  await expect(timeline.getByRole("heading", { name: "Banco de Dados" })).toBeVisible();
  await expect(timeline.getByRole("heading", { name: "Sem matéria" })).toBeVisible();

  // Marcar pela linha do tempo.
  await rows
    .filter({ hasText: "Prova parcial" })
    .getByRole("button", { name: "Concluída", exact: true })
    .click();
  await expect(page.getByText("Tarefa marcada como concluída.")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await timeline.getByRole("link", { name: "Concluídas", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Prova parcial");
  await expect(rows.first().getByRole("button", { name: "Reabrir" })).toBeVisible();
  await expectPath(page, /^\/calendario\?janela=30&status=concluidas$/);

  // Calendário: vai até o mês do seminário e escolhe o dia.
  const month = page.getByTestId("calendario-mes");
  if (inTen.slice(0, 7) !== today.slice(0, 7)) {
    await page.getByRole("link", { name: "Próximo mês" }).click();
    // A grade de novembro já mostra o começo de dezembro: espera trocar de mês antes de clicar.
    await expectPath(page, new RegExp(`mes=${inTen.slice(0, 7)}`));
    const nextMonth = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
      new Date(`${inTen}T12:00:00Z`),
    );
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${nextMonth}`, "i") }),
    ).toBeVisible();
  }
  const dayButton = month.locator(`button[data-date="${inTen}"]`);
  await expect(dayButton).toHaveAccessibleName(/1 tarefa/);
  await dayButton.click();
  await expect(dayButton).toHaveAttribute("aria-pressed", "true");
  const panel = page.getByTestId("dia-escolhido");
  const seminar = panel.getByTestId("linha-tarefa").filter({ hasText: "Seminário" });
  await expect(seminar).toBeVisible();
  await seminar.getByRole("button", { name: "Não concluída" }).click();
  await expect(page.getByText("Tarefa marcada como não concluída.")).toBeVisible();
  await expect(seminar).toHaveAttribute("data-status", "not_completed");

  // Filtro de status do calendário: só pendentes some com o seminário.
  await page.getByLabel("Status das tarefas").selectOption({ label: "Pendentes" });
  await expectPath(page, /situacao=pendentes/);
  await expect(month.locator(`button[data-date="${inTen}"]`)).not.toHaveAccessibleName(/tarefa/);

  // "Hoje" volta ao mês atual; "Nova tarefa neste dia" já vem com a data.
  await page.getByRole("link", { name: "Voltar para o mês de hoje" }).click();
  const todayButton = month.locator(`button[data-date="${today}"]`);
  await expect(todayButton).toHaveAttribute("aria-current", "date");
  // As aulas da grade aparecem no dia (o aluno de teste tem aula hoje).
  await expect(todayButton).toHaveAccessibleName(/1 aula/);
  await todayButton.click();
  const todayClass = panel.getByTestId("aula-do-dia");
  await expect(todayClass).toHaveCount(1);
  await expect(todayClass).toContainText("Banco de Dados");
  await expect(todayClass.getByRole("link", { name: "Registrar a chamada" })).toHaveAttribute(
    "href",
    `/hoje?data=${today}`,
  );
  // Esconder as aulas tira da grade (o painel do dia continua mostrando).
  await page.getByLabel("Mostrar aulas").uncheck();
  await expect(todayButton).not.toHaveAccessibleName(/aula/);
  await page.getByLabel("Mostrar aulas").check();
  await month.locator(`button[data-date="${inTwo}"]`).click();
  await panel.getByRole("link", { name: "Nova tarefa neste dia" }).click();
  await expect(page.getByLabel("Data do prazo")).toHaveValue(inTwo);
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  await expectPath(page, /^\/calendario\?/);

  // Celular: as 5 abas (Início, Hoje, Calendário, Tarefas, Notas) cabem numa linha só.
  if (testInfo.project.name === "celular") {
    const tabs = page.getByRole("navigation", { name: "Principal" }).getByRole("link");
    await expect(tabs).toHaveCount(5);
    const tops = await tabs.evaluateAll((links) =>
      links.map((l) => Math.round(l.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
  }

  // Acessibilidade com conteúdo na tela.
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map(
      (v) =>
        `${v.id}: ${v.help} — ${v.nodes
          .slice(0, 4)
          .map((n) => `${n.target.join(" ")} (${n.failureSummary?.split("\n").slice(1).join(" ")})`)
          .join("; ")}`,
    ),
  ).toEqual([]);
});
