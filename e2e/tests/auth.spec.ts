import { expect, type Page, test } from "@playwright/test";
import { waitForEmail, waitForLink } from "./mailpit";
import { expectPath, openEmailLink, realPath, signUp } from "./setup-helpers";
import { totp } from "./totp";

const uniqueEmail = (testInfo: { project: { name: string } }) =>
  `e2e.${testInfo.project.name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@presenca.local`;

/** Sai pela página Conta (no celular o botão do cabeçalho fica escondido). */
async function logout(page: Page) {
  await page.goto("/conta");
  await page.getByRole("region", { name: "Sair" }).getByRole("button", { name: "Sair" }).click();
}

test("cadastro pelo link do e-mail → sair → entrar → esqueci a senha → nova senha", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo);
  const password = "uma-senha-bem-forte-do-e2e-1";
  const newPassword = "outra-senha-bem-forte-do-e2e-2";

  // Sem sessão, a página inicial é a apresentação do app (a barra continua em "/").
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Saiba quanto você ainda pode faltar." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Já tenho conta" })).toHaveAttribute(
    "href",
    "/entrar",
  );

  // Cadastro: a conta só nasce no link do e-mail, que já entra e confirma o e-mail.
  await page.getByRole("link", { name: "Criar conta grátis" }).first().click();
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await signUp(page, { name: "Ana E2E", email, password });
  await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();
  expect(await realPath(page)).not.toMatch(/token=/);
  await expect(page.getByText("Confirme seu e-mail.")).toBeHidden();
  // As sessões ficam na página Conta.
  await page.getByRole("link", { name: "Conta" }).click();
  await expect(page.getByText("este dispositivo")).toBeVisible();
  await page.getByRole("link", { name: "Início" }).first().click();

  // Sair e entrar de novo; senha errada mostra a mensagem genérica.
  await logout(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await expectPath(page, /^\/entrar$/);
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
  expect(await realPath(page)).not.toMatch(/token=/);
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
  await signUp(laptop, { name: "Bia Dois Aparelhos", email, password });
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
  await expectPath(phone, /^\/entrar(\?|$)/);
});

test("cadastro com e-mail que já tem conta não revela nada na tela", async ({
  browser,
}, testInfo) => {
  const email = uniqueEmail(testInfo);
  const owner = await (await browser.newContext()).newPage();
  await owner.goto("/cadastro");
  await signUp(owner, { name: "Dona da Conta", email, password: "senha-forte-da-dona-e2e" });
  await expect(owner.getByRole("heading", { name: "Olá, Dona" })).toBeVisible();

  // Outra pessoa tenta cadastrar o mesmo e-mail: a tela é a mesma de um e-mail novo.
  const other = await (await browser.newContext()).newPage();
  const triedAt = new Date(Date.now() - 1_000);
  await other.goto("/cadastro");
  await other.getByLabel("Nome").fill("Outra Pessoa");
  await other.getByLabel("E-mail").fill(email);
  await other.getByLabel("Senha", { exact: true }).fill("senha-forte-da-outra-e2e");
  await other.getByRole("button", { name: "Criar conta" }).click();
  await expect(other.getByText("Confira seu e-mail.")).toBeVisible();

  // Quem recebe é a dona, com um aviso (sem link que crie ou altere conta).
  const notice = await waitForEmail(email, "Você já tem uma conta", triedAt);
  expect(notice.text).not.toMatch(/token=/);
});

test("conta sem senha exclui a conta pelo link enviado ao e-mail", async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo);
  const startedAt = new Date(Date.now() - 1_000);
  await page.goto("/entrar/link");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await openEmailLink(page, await waitForLink(email, "Crie sua conta", startedAt));
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  await page.goto("/conta");
  const lgpd = page.getByRole("region", { name: "Seus dados e privacidade (LGPD)" });
  await lgpd.getByRole("button", { name: "Excluir minha conta" }).click();
  await expect(lgpd).toContainText(email);
  const askedAt = new Date(Date.now() - 1_000);
  await lgpd.getByRole("button", { name: "Enviar link de exclusão" }).click();
  await expect(lgpd.getByText("Enviamos um link para")).toBeVisible();

  // Abrir o link não exclui sozinho: pede a confirmação.
  await openEmailLink(page, await waitForLink(email, "Confirme a exclusão da sua conta", askedAt));
  await expect(page.getByRole("heading", { name: "Excluir conta" })).toBeVisible();
  expect(await realPath(page)).not.toMatch(/token=/);
  await page.getByRole("button", { name: "Excluir minha conta" }).click();
  await expectPath(page, /^\/entrar$/);

  // A conta não existe mais: o mesmo e-mail recebe o convite de criar conta de novo.
  const againAt = new Date(Date.now() - 1_000);
  await page.goto("/entrar/link");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await waitForLink(email, "Crie sua conta", againAt);
});

test("verificação em duas etapas: ligar, entrar com o código e com um código de recuperação", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo);
  const password = "senha-forte-com-dois-fatores";
  await page.goto("/cadastro");
  await signUp(page, { name: "Duda Dois Fatores", email, password });
  await expect(page.getByRole("heading", { name: "Olá, Duda" })).toBeVisible();

  // Ligar na página Conta: QR Code, chave para digitar, código do app e senha.
  await page.goto("/conta");
  const mfa = page.getByRole("region", { name: "Verificação em duas etapas" });
  await mfa.getByRole("button", { name: "Ligar verificação em duas etapas" }).click();
  await expect(
    mfa.getByRole("img", { name: /QR Code para adicionar o Monitor de Presenças/ }),
  ).toBeVisible();
  const secret = (await mfa.getByTestId("mfa-chave").textContent())!.replace(/\s/g, "");
  await mfa.getByLabel("Código do app").fill(totp(secret));
  await mfa.getByLabel("Senha atual").fill(password);
  await mfa.getByRole("button", { name: "Ligar", exact: true }).click();
  await expect(mfa.getByTestId("mfa-codigos").locator("li")).toHaveCount(10);
  const codes = (await mfa.getByTestId("mfa-codigos").locator("li").allTextContents()).map((c) =>
    c.trim(),
  );
  expect(codes).toHaveLength(10);
  await mfa.getByRole("button", { name: "Já guardei" }).click();
  await expect(mfa).toContainText("Ligada");
  await expect(mfa).toContainText("Restam 10 códigos de recuperação.");

  // Login: a senha certa leva à tela do código.
  await logout(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();
  await page.getByLabel("Código do app").fill("000000");
  await page.getByRole("button", { name: "Verificar e entrar" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Código incorreto");
  // O código de agora já foi usado para ligar: o app mostra o próximo.
  await page.getByLabel("Código do app").fill(totp(secret, 1));
  await page.getByRole("button", { name: "Verificar e entrar" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Duda" })).toBeVisible();

  // Sem o celular: código de recuperação.
  await logout(page);
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: /Usar um código de recuperação/ }).click();
  await page.getByLabel("Código de recuperação").fill(codes[0]!);
  await page.getByRole("button", { name: "Verificar e entrar" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Duda" })).toBeVisible();

  // Desligar pede um código (aqui, outro de recuperação).
  await page.goto("/conta");
  await expect(mfa).toContainText("Restam 9 códigos de recuperação.");
  await mfa.getByRole("button", { name: "Desligar" }).click();
  await mfa.getByLabel("Código do app ou de recuperação").fill(codes[1]!);
  await mfa.getByRole("button", { name: "Desligar" }).click();
  await expect(mfa.getByRole("button", { name: "Ligar verificação em duas etapas" })).toBeVisible();
});

test("conta sem senha liga a verificação em duas etapas pelo link do e-mail", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo);
  const startedAt = new Date(Date.now() - 1_000);
  await page.goto("/entrar/link");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await openEmailLink(page, await waitForLink(email, "Crie sua conta", startedAt));
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  await page.goto("/conta");
  const mfa = page.getByRole("region", { name: "Verificação em duas etapas" });
  await expect(mfa).toContainText(email);
  const askedAt = new Date(Date.now() - 1_000);
  await mfa.getByRole("button", { name: "Enviar link para ligar" }).click();
  await expect(mfa.getByText("Enviamos um link para")).toBeVisible();

  await openEmailLink(
    page,
    await waitForLink(email, "Ligar a verificação em duas etapas", askedAt),
  );
  expect(await realPath(page)).not.toMatch(/token=/);
  const panel = page.getByRole("region", { name: "Verificação em duas etapas" });
  await panel.getByRole("button", { name: "Continuar" }).click();
  const secret = (await panel.getByTestId("mfa-chave").textContent())!.replace(/\s/g, "");
  // Sem senha para confirmar: o link do e-mail já fez esse papel.
  await expect(panel.getByLabel("Senha atual")).toHaveCount(0);
  await panel.getByLabel("Código do app").fill(totp(secret));
  await panel.getByRole("button", { name: "Ligar", exact: true }).click();
  await expect(panel.getByTestId("mfa-codigos").locator("li")).toHaveCount(10);
  await panel.getByRole("button", { name: "Já guardei" }).click();
  await expect(panel).toContainText("Ligada");
});
