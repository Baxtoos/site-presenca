import { expect, type Page, test } from "@playwright/test";
import { waitForLink } from "./mailpit";

const uniqueEmail = (testInfo: { project: { name: string } }) =>
  `e2e.${testInfo.project.name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@presenca.local`;

/** Sai pela página Conta (no celular o botão do cabeçalho fica escondido). */
async function logout(page: Page) {
  await page.goto("/conta");
  await page.getByRole("region", { name: "Sair" }).getByRole("button", { name: "Sair" }).click();
}

/** Abre o link do e-mail no mesmo endereço do teste (o e-mail usa WEB_ORIGIN). */
async function openEmailLink(page: Page, link: string) {
  const url = new URL(link);
  await page.goto(`${url.pathname}${url.search}`);
}

test("cadastro → confirmar e-mail → sair → entrar → esqueci a senha → nova senha", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo);
  const password = "uma-senha-bem-forte-do-e2e-1";
  const newPassword = "outra-senha-bem-forte-do-e2e-2";
  const startedAt = new Date(Date.now() - 1_000);

  // Sem sessão, a página inicial manda para o login.
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);

  // Cadastro: entra direto, com o aviso de e-mail não confirmado.
  await page.getByRole("link", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await page.getByLabel("Nome").fill("Ana E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();
  await expect(page.getByText("Confirme seu e-mail.")).toBeVisible();
  // As sessões ficam na página Conta.
  await page.getByRole("link", { name: "Conta" }).click();
  await expect(page.getByText("este dispositivo")).toBeVisible();
  await page.getByRole("link", { name: "Início" }).first().click();

  // Confirma o e-mail pelo link: o token some da barra de endereço.
  await openEmailLink(page, await waitForLink(email, "Confirme seu e-mail", startedAt));
  await expect(page.getByText("E-mail confirmado.")).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByRole("link", { name: "Ir para o app" }).click();
  await expect(page.getByText("Confirme seu e-mail.")).toBeHidden();

  // Sair e entrar de novo; senha errada mostra a mensagem genérica.
  await logout(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("E-mail ou senha incorretos.");
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();

  // Esqueci a senha (pedido feito deslogado).
  await logout(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Esqueci a senha" }).click();
  await expect(page.getByRole("heading", { name: "Esqueci a senha" })).toBeVisible();
  const resetRequestedAt = new Date(Date.now() - 1_000);
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de redefinição" }).click();
  await expect(page.getByText(`Se existir uma conta com ${email}`)).toBeVisible();

  await openEmailLink(page, await waitForLink(email, "Redefinir sua senha", resetRequestedAt));
  await expect(page.getByRole("heading", { name: "Escolher nova senha" })).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
  await page.getByLabel("Repita a nova senha").fill(newPassword);
  await page.getByRole("button", { name: "Salvar e entrar" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();

  // A senha antiga não funciona mais.
  await logout(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("E-mail ou senha incorretos.");
});

test("link de acesso por e-mail cria a conta sem senha", async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo);
  const startedAt = new Date(Date.now() - 1_000);

  await page.goto("/entrar");
  await page.getByRole("link", { name: "Receber link de acesso por e-mail" }).click();
  await expect(page.getByRole("heading", { name: "Entrar sem senha" })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(page.getByText(`Se ${email} puder receber`)).toBeVisible();

  await openEmailLink(page, await waitForLink(email, "Crie sua conta", startedAt));
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  // Conta criada pelo link já nasce com e-mail confirmado.
  await expect(page.getByText("Confirme seu e-mail.")).toBeHidden();
});

test("encerrar a sessão de outro dispositivo derruba aquele dispositivo", async ({
  browser,
}, testInfo) => {
  const email = uniqueEmail(testInfo);
  const password = "senha-forte-para-dois-aparelhos";

  const laptop = await (await browser.newContext()).newPage();
  await laptop.goto("/cadastro");
  await laptop.getByLabel("Nome").fill("Bia Dois Aparelhos");
  await laptop.getByLabel("E-mail").fill(email);
  await laptop.getByLabel("Senha").fill(password);
  await laptop.getByRole("button", { name: "Criar conta" }).click();
  await expect(laptop.getByRole("heading", { name: "Olá, Bia" })).toBeVisible();

  const phone = await (await browser.newContext()).newPage();
  await phone.goto("/entrar");
  await phone.getByLabel("E-mail").fill(email);
  await phone.getByLabel("Senha").fill(password);
  await phone.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(phone.getByRole("heading", { name: "Olá, Bia" })).toBeVisible();

  await laptop.goto("/conta");
  await expect(laptop.getByRole("button", { name: "Encerrar" })).toHaveCount(1);
  await laptop.getByRole("button", { name: "Encerrar" }).click();
  await expect(laptop.getByRole("button", { name: "Encerrar" })).toHaveCount(0);

  await phone.reload();
  await expect(phone).toHaveURL(/\/entrar$/);
});
