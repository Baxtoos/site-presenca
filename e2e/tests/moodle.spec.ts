import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { setupStudentWithClassToday, shift, todayInSaoPaulo } from "./setup-helpers";

const icsDate = (date: string, time = "23:59") =>
  new Date(`${date}T${time}:00-03:00`)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

let server: Server;
let base: string;
let feed = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const token = new URL(req.url ?? "/", "http://x").searchParams.get("authtoken");
    if (token !== "token-e2e") return res.writeHead(403).end();
    res.writeHead(200, { "content-type": "text/calendar" }).end(feed);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server?.close());

test("Moodle: conectar pelo link do calendário, ligar turmas e ver as entregas no calendário", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await setupStudentWithClassToday(page, testInfo, {
    name: "Mário Moodle",
    slug: "moodle",
    subject: "Redes de Computadores",
  });
  const today = todayInSaoPaulo();
  feed = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${testInfo.project.name}-1@moodle`,
    "SUMMARY:Lista de sub-redes está para ser entregue",
    `DTSTART:${icsDate(shift(today, 3))}`,
    "CATEGORIES:RC1 - 2026-2",
    "END:VEVENT",
    "BEGIN:VEVENT",
    `UID:${testInfo.project.name}-2@moodle`,
    "SUMMARY:Questionário 1 abre",
    `DTSTART:${icsDate(shift(today, 1), "08:00")}`,
    "CATEGORIES:RC1 - 2026-2",
    "END:VEVENT",
    "BEGIN:VEVENT",
    `UID:${testInfo.project.name}-3@moodle`,
    "SUMMARY:Fórum de outra turma está para ser entregue",
    `DTSTART:${icsDate(shift(today, 5))}`,
    "CATEGORIES:OUTRA - 2026-2",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  await page.goto("/conta");
  await page
    .getByRole("region", { name: "Moodle" })
    .getByRole("link", { name: "Conectar", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Moodle", exact: true })).toBeVisible();
  await expect(page.getByText("Exportar calendário", { exact: true })).toBeVisible();

  await page
    .getByLabel("Link do calendário do Moodle")
    .fill(`${base}/calendar/export_execute.php?userid=1&authtoken=errado`);
  await page.getByRole("button", { name: "Testar e conectar" }).click();
  await expect(page.getByText("O Moodle recusou o link.")).toBeVisible();

  await page
    .getByLabel("Link do calendário do Moodle")
    .fill(`${base}/calendar/export_execute.php?userid=1&authtoken=token-e2e&preset_what=all`);
  await page.getByRole("button", { name: "Testar e conectar" }).click();
  await expect(page.getByText("Sincronizado: 2 tarefas novas.")).toBeVisible();
  const connected = page.getByTestId("moodle-conectado");
  await expect(connected).toContainText("127.0.0.1");
  await expect(connected).toContainText("Desligada (só o calendário)");
  await expect(page.locator("body")).not.toContainText("token-e2e");

  const courses = page.getByTestId("turma-moodle");
  await expect(courses).toHaveCount(2);
  await page.getByLabel(/RC1 - 2026-2/).selectOption({ label: "Redes de Computadores" });
  await expect(page.getByText("Turma ligada à matéria.")).toBeVisible();
  await page.getByLabel(/OUTRA - 2026-2/).selectOption({ label: "Ignorar esta turma" });
  await expect(page.getByText("Turma OUTRA - 2026-2 ignorada")).toBeVisible();
  await expect(courses.filter({ hasText: "OUTRA" })).toContainText("0 tarefas importadas");

  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.goto("/calendario?janela=30");
  const timeline = page.getByRole("region", { name: "Linha do tempo" });
  const row = timeline.getByTestId("linha-tarefa").filter({ hasText: "Lista de sub-redes" });
  await expect(row).toContainText("Moodle");
  await expect(row).toContainText("Redes de Computadores");
  await expect(timeline.getByText("Fórum de outra turma")).toHaveCount(0);

  await row.getByRole("link", { name: /Editar/ }).click();
  await expect(page.getByText("Esta tarefa veio do Moodle")).toBeVisible();
  await expect(page.getByLabel("Título")).toBeDisabled();
  await expect(page.getByLabel("Data do prazo")).toBeDisabled();
  await page.getByLabel("Observações (opcional)").fill("Fazer em dupla");
  await page.getByRole("button", { name: "Salvar tarefa" }).click();
  await expect(page.getByText("Tarefa salva.")).toBeVisible();

  await page.goto("/conta/moodle");
  await page.getByRole("button", { name: "Desconectar o Moodle" }).click();
  await page.getByRole("button", { name: "Desconectar e manter as tarefas" }).click();
  await expect(
    page.getByText("Moodle desconectado. As tarefas ficaram como manuais."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conectar em 1 minuto" })).toBeVisible();
});
