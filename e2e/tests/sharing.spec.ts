import { expect, test } from "@playwright/test";
import { expectPath, setupStudentWithClassToday, signUp, uniqueEmail } from "./setup-helpers";

/**
 * Compartilhamento de ponta a ponta: a Ana gera um código; um colega SEM conta abre o link, vê a
 * prévia, cria a conta, volta direto para a importação e importa. A Ana vê a importação contada.
 */
test("gera código, colega sem conta abre o link, cria a conta e importa a grade", async ({
  page,
  browser,
}, testInfo) => {
  // Fluxo longo (várias páginas); no `next dev`, cada página nova compila na primeira visita.
  test.slow();
  const email = uniqueEmail(testInfo, "compartilha");
  await setupStudentWithClassToday(page, testInfo, {
    name: "Ana Compartilha",
    slug: "compartilha",
    subject: "Estatística",
    email,
  });
  // Compartilhar exige e-mail confirmado (o cadastro já confirmou).

  await page.goto("/");
  await page.getByRole("link", { name: "Gerenciar semestre" }).click();
  const share = page.getByRole("region", { name: "Compartilhar com colegas" });
  await share.getByRole("button", { name: "Gerar código para colegas" }).click();
  await share.getByLabel("Instituição (opcional)").fill("Universidade Exemplo");
  await share.getByRole("button", { name: "Gerar código" }).click();
  const generated = share.getByTestId("codigo-gerado");
  await expect(generated).toBeVisible();
  await expect(generated.getByRole("img", { name: "QR Code para importar a grade" })).toBeVisible();
  const url = (await generated.getByTestId("link-importacao").textContent())!.trim();
  const code = url.split("/importar/")[1]!;
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);

  // Colega, em outro navegador, sem conta.
  const colleague = await browser.newContext();
  const other = await colleague.newPage();
  // Digita o código do jeito que ouviu: minúsculas e com hífen.
  await other.goto("/importar");
  await other
    .getByLabel("Código recebido")
    .fill(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase());
  await other.getByRole("button", { name: "Ver a grade" }).click();
  await expect(other.getByRole("heading", { name: "Atual" })).toBeVisible();
  await expect(other.getByText("Universidade Exemplo")).toBeVisible();
  const materia = other.getByTestId("materia-modelo").filter({ hasText: "Estatística" });
  await expect(materia).toContainText("limite de 18 faltas");

  await other.getByRole("link", { name: "Criar conta e importar" }).click();
  await expect(other.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await signUp(other, {
    name: "Bruno Colega",
    email: uniqueEmail(testInfo, "colega"),
    password: "senha-forte-do-colega-e2e",
  });

  // O link do e-mail leva de volta para a importação, já logado.
  await expectPath(other, new RegExp(`^/importar/${code}$`));
  await other.getByRole("button", { name: "Importar este semestre" }).click();
  await expect(other.getByRole("heading", { name: /^Atual/ })).toBeVisible();
  const card = other.getByRole("main").getByRole("link", { name: /Estatística/ });
  await expect(card).toContainText("0 de 18 faltas");
  await colleague.close();

  // A Ana vê a importação contada.
  await page.goto("/compartilhar");
  const mine = page
    .getByTestId("meu-codigo")
    .filter({ hasText: `${code.slice(0, 4)}-${code.slice(4)}` });
  await expect(mine).toContainText("1 importação");
  await expect(mine).toContainText("Ativo");

  // Revogar: o link para de funcionar.
  page.once("dialog", (d) => void d.accept());
  await mine.getByRole("button", { name: `Revogar o código ${code}` }).click();
  await expect(mine).toContainText("Revogado");
  const late = await browser.newContext();
  const latePage = await late.newPage();
  await latePage.goto(`/importar/${code}`);
  await expect(latePage.getByText(/Este código não existe mais/)).toBeVisible();
  await late.close();
});

test("login com retorno: só aceita caminhos do próprio app", async ({ page }) => {
  await page.goto("/entrar?next=https://malicioso.exemplo/roubo");
  await expect(page.getByRole("link", { name: "Criar conta" })).toHaveAttribute(
    "href",
    "/cadastro",
  );
  await page.goto("/entrar?next=/importar/ABCD2345");
  await expect(page.getByRole("link", { name: "Criar conta" })).toHaveAttribute(
    "href",
    "/cadastro?next=%2Fimportar%2FABCD2345",
  );
});
