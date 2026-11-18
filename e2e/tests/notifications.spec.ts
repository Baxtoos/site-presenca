import { expect, test } from "@playwright/test";
import { waitForEmail, waitForLink } from "./mailpit";
import { setupStudentWithClassToday, uniqueEmail } from "./setup-helpers";

/**
 * Alerta de faltas de ponta a ponta: a API grava o aviso junto com a falta, a central mostra na hora
 * e o worker (acordado pelo NOTIFY) entrega o e-mail no Mailpit.
 */
test("falta que cruza 50% do limite: sino, central de avisos e e-mail", async ({
  page,
}, testInfo) => {
  const startedAt = new Date(Date.now() - 1_000);
  const email = uniqueEmail(testInfo, "avisos");
  await setupStudentWithClassToday(page, testInfo, {
    name: "Helena Avisos",
    slug: "avisos",
    subject: "Química",
    email,
  });

  // E-mail confirmado: só assim os alertas vão por e-mail.
  const link = new URL(await waitForLink(email, "Confirme seu e-mail", startedAt));
  await page.goto(`${link.pathname}${link.search}`);
  await expect(page.getByText("E-mail confirmado.")).toBeVisible();

  // Limite fixo de 4 tempos: uma falta (2 tempos) = 50%.
  await page.goto("/");
  await page
    .getByRole("region", { name: "Suas matérias" })
    .getByRole("link", { name: /Química/ })
    .click();
  await page.getByRole("radio", { name: /Limite fixo/ }).click();
  await page.getByLabel("Máximo de faltas (tempos)").fill("4");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByLabel("Resumo de faltas")).toContainText("0 de 4");

  const sino = page.getByTestId("sino");
  await expect(sino).toHaveAttribute("aria-label", "Avisos");

  await page.getByRole("link", { name: "Hoje", exact: true }).click();
  const aula = page.getByTestId("aula").filter({ hasText: "Química" });
  await aula.getByRole("button", { name: "Faltei", exact: true }).click();
  await expect(page.getByText("Falta registrada em Química.")).toBeVisible();
  await expect(sino).toHaveAttribute("aria-label", "Avisos, 1 não lido");

  // Central de avisos.
  await sino.click();
  await expect(page.getByRole("heading", { name: "Avisos", exact: true })).toBeVisible();
  const aviso = page.getByTestId("aviso").first();
  await expect(aviso).toContainText("Química: 50% do limite de faltas");
  await expect(aviso).toContainText(
    "Você tem 2 de 4 faltas. Ainda pode faltar 2 tempos (cerca de 1 aula).",
  );

  // E-mail entregue pelo worker, com o mesmo texto.
  const alert = await waitForEmail(email, "Química: 50% do limite de faltas", startedAt);
  expect(alert.text).toContain("Ainda pode faltar 2 tempos");
  expect(alert.text).toContain("/materias/");

  // Abrir o aviso marca como lido e leva à matéria.
  await aviso.click();
  await expect(page.getByRole("heading", { name: "Posso faltar?" })).toBeVisible();
  await expect(sino).toHaveAttribute("aria-label", "Avisos");
  await page.goto("/avisos");
  await expect(page.getByText("Tudo lido.")).toBeVisible();
});

test("preferências de aviso: salvar e continuar salvas ao voltar", async ({ page }, testInfo) => {
  await setupStudentWithClassToday(page, testInfo, {
    name: "Igor Preferências",
    slug: "prefs",
    subject: "Geografia",
  });
  await page.getByRole("link", { name: "Conta" }).click();
  const form = page.getByRole("form", { name: "Avisos" });
  await expect(form).toBeVisible();
  // Sem e-mail confirmado, avisa por que o e-mail não chega.
  await expect(form).toContainText("Confirme seu e-mail para receber os alertas por e-mail");

  await form.getByRole("checkbox", { name: "50%" }).uncheck();
  await form.getByRole("radio", { name: /Todo dia com aula/ }).check();
  await form.getByLabel("Horário", { exact: true }).fill("20:30");
  await form.getByRole("checkbox", { name: /Não mandar e-mail nem notificação/ }).check();
  await form.getByRole("button", { name: "Salvar avisos" }).click();
  await expect(page.getByText("Preferências de aviso salvas.")).toBeVisible();

  await page.reload();
  const again = page.getByRole("form", { name: "Avisos" });
  await expect(again.getByRole("checkbox", { name: "50%" })).not.toBeChecked();
  await expect(again.getByRole("checkbox", { name: "75%" })).toBeChecked();
  await expect(again.getByRole("radio", { name: /Todo dia com aula/ })).toBeChecked();
  await expect(again.getByLabel("Horário", { exact: true })).toHaveValue("20:30");
  await expect(again.getByLabel("De", { exact: true })).toHaveValue("22:00");
  await expect(again.getByLabel("Até", { exact: true })).toHaveValue("07:00");
});
