import { expect, type Page, test } from "@playwright/test";
import { realPath, setupStudentWithClassToday } from "./setup-helpers";

/** O que aparece na barra de endereço: só o domínio, sem caminho nem parâmetros. */
async function expectBarMasked(page: Page) {
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe("/");
}

test("a barra mostra só o domínio; Voltar, Avançar e recarregar continuam funcionando", async ({
  page,
}, testInfo) => {
  test.slow();
  await setupStudentWithClassToday(page, testInfo, {
    name: "Mia Máscara",
    slug: "mascara",
    subject: "Topologia",
  });

  await page.goto("/semestres");
  const semestres = page.getByRole("heading", { name: "Semestres", exact: true });
  await expect(semestres).toBeVisible();
  await expectBarMasked(page);
  expect(await realPath(page)).toBe("/semestres");

  // Navegação pelo app: troca a tela, a barra continua igual.
  await page.goto("/conta");
  const conta = page.getByRole("heading", { name: "Conta", exact: true });
  await expect(conta).toBeVisible();
  const notas = page.getByRole("heading", { name: "Notas", exact: true });
  await page.getByRole("link", { name: "Notas" }).first().click();
  await expect(notas).toBeVisible();
  await expectBarMasked(page);

  // Voltar e Avançar restauram a tela certa.
  await page.goBack();
  await expect(conta).toBeVisible();
  await expectBarMasked(page);
  expect(await realPath(page)).toBe("/conta");
  await page.goForward();
  await expect(notas).toBeVisible();
  await expectBarMasked(page);

  // Recarregar (F5 / puxar para atualizar) volta para a mesma tela, não para o início.
  await page.reload();
  await expect(notas).toBeVisible();
  await expectBarMasked(page);
  expect(await realPath(page)).toBe("/notas");
});
