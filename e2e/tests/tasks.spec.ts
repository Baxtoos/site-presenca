import { expect, type Page, test } from "@playwright/test";
import { waitForEmail } from "./mailpit";
import { setupStudentWithClassToday, shift, todayInSaoPaulo } from "./setup-helpers";

function inSaoPaulo(minutes: number): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(Date.now() + minutes * 60_000))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

async function newTask(
  page: Page,
  task: {
    title: string;
    date: string;
    time: string;
    remind?: string;
    subject?: string;
    link?: string;
  },
) {
  await page.goto("/tarefas/nova?voltar=/tarefas");
  await expect(page.getByRole("heading", { name: "Nova tarefa" })).toBeVisible();
  await page.getByLabel("Título").fill(task.title);
  if (task.subject)
    await page.getByLabel("Matéria (opcional)").selectOption({ label: task.subject });
  await page.getByLabel("Data do prazo").fill(task.date);
  await page.getByLabel("Hora do prazo").fill(task.time);
  if (task.remind) await page.getByLabel("Avisar").selectOption({ label: task.remind });
  if (task.link) await page.getByLabel("Link da atividade (opcional)").fill(task.link);
  await page.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(page.getByText("Tarefa criada.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tarefas", exact: true })).toBeVisible();
}

test("tarefas: cadastrar, receber o aviso antes do prazo e marcar se entregou", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const email = `e2e.tarefas.${testInfo.project.name}.${Date.now()}@presenca.local`;
  await setupStudentWithClassToday(page, testInfo, {
    name: "Tânia Tarefas",
    slug: "tarefas",
    subject: "Algoritmos",
    email,
  });
  const startedAt = new Date(Date.now() - 1_000);

  await page.goto("/");
  await page.getByRole("link", { name: "Calendário" }).first().click();
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ver em lista" }).click();
  await expect(page.getByRole("heading", { name: "Tarefas", exact: true })).toBeVisible();
  await expect(page.getByText("Nenhuma tarefa pendente.")).toBeVisible();

  const soon = inSaoPaulo(40);
  await newTask(page, {
    title: "Lista 3",
    subject: "Algoritmos",
    date: soon.date,
    time: soon.time,
    remind: "1 h antes",
    link: "https://moodle.exemplo.edu.br/mod/assign/view.php?id=3",
  });
  await newTask(page, {
    title: "Relatório antigo",
    date: shift(todayInSaoPaulo(), -1),
    time: "18:00",
  });
  await newTask(page, {
    title: "Projeto final",
    date: shift(todayInSaoPaulo(), 10),
    time: "23:59",
    remind: "Sem aviso",
  });

  const cards = page.getByTestId("tarefa");
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Vencidas: falta registrar (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Próximas 48 h (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depois (1)" })).toBeVisible();
  const overdue = cards.filter({ hasText: "Relatório antigo" });
  await expect(overdue).toContainText("O prazo passou. Você entregou?");
  const list3 = cards.filter({ hasText: "Lista 3" });
  await expect(list3).toContainText("Algoritmos · prazo");
  await expect(list3).toContainText(/vence em \d+ min/);
  await expect(
    list3.getByRole("link", { name: "Abrir atividade (abre em nova aba)" }),
  ).toHaveAttribute("href", "https://moodle.exemplo.edu.br/mod/assign/view.php?id=3");
  await expect(cards.filter({ hasText: "Projeto final" })).toContainText("Sem aviso.");

  await page.goto("/");
  const upcoming = page.getByTestId("proximas-entregas");
  await expect(upcoming).toContainText("Lista 3");
  await expect(upcoming).toContainText("Relatório antigo");
  await expect(page.getByText("1 tarefa passou do prazo: conte se você entregou.")).toBeVisible();

  const mail = await waitForEmail(email, "Entrega em 1 h: Lista 3", startedAt, 90_000);
  expect(mail.text).toContain("Matéria: Algoritmos");
  expect(mail.text).toContain("/calendario");
  await page.goto("/avisos");
  await expect(page.getByText("Entrega em 1 h: Lista 3")).toBeVisible();

  await page.goto("/tarefas");
  await cards
    .filter({ hasText: "Relatório antigo" })
    .getByRole("button", { name: "Não concluída" })
    .click();
  await expect(page.getByText("Tarefa marcada como não concluída.")).toBeVisible();
  await cards
    .filter({ hasText: "Lista 3" })
    .getByRole("button", { name: "Concluída", exact: true })
    .click();
  await expect(page.getByText("Tarefa marcada como concluída.")).toBeVisible();
  await expect(cards).toHaveCount(1);

  await page.getByRole("link", { name: "Concluídas", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Lista 3");
  await cards.first().getByRole("button", { name: "Voltar para pendente" }).click();
  await expect(page.getByText("Tarefa voltou para pendente.")).toBeVisible();
  await expect(cards).toHaveCount(0);

  await page.getByRole("link", { name: "Não concluídas" }).click();
  await expect(cards.first()).toContainText("Relatório antigo");

  await page.getByRole("link", { name: "Todas", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page
    .getByRole("combobox", { name: "Matéria", exact: true })
    .selectOption({ label: "Algoritmos" });
  await expect(cards).toHaveCount(1);

  await page.goto("/tarefas");
  await cards.filter({ hasText: "Projeto final" }).getByRole("link", { name: "Editar" }).click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible();
  await page.getByLabel("Título").fill("Projeto final (grupo)");
  await page.getByRole("button", { name: "Salvar tarefa" }).click();
  await expect(page.getByText("Tarefa salva.")).toBeVisible();
  const project = cards.filter({ hasText: "Projeto final (grupo)" });
  await project.getByRole("button", { name: "Excluir" }).click();
  await project.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Tarefa apagada.")).toBeVisible();
  await expect(cards.filter({ hasText: "Projeto final" })).toHaveCount(0);
});
