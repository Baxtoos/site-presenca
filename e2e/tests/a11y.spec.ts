import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { realPath, setupStudentWithClassToday } from "./setup-helpers";

/**
 * Acessibilidade (WCAG 2.1 A e AA) com o axe-core em todas as telas, nos temas claro e escuro.
 * Qualquer violação falha o teste, com a lista do que corrigir.
 */
async function expectAccessible(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  // Mede a tela parada: título reposto depois de atualizar e animações de entrada concluídas
  // (no meio de um fade, o contraste medido é o de uma cor semitransparente).
  await page.waitForFunction(
    () =>
      document.title.length > 0 &&
      document
        .getAnimations()
        .every((a) => (a as CSSAnimation).animationName !== "rise" || a.playState === "finished"),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map(
          (n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n").slice(1).join(" ")}`,
        )
        .join("\n"),
  );
  expect(report, `violações de acessibilidade em ${label}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`telas acessíveis (tema ${scheme === "light" ? "claro" : "escuro"})`, async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.emulateMedia({ colorScheme: scheme });

    // "/" sem sessão é a apresentação pública.
    for (const url of ["/", "/entrar", "/cadastro", "/esqueci-senha", "/privacidade", "/termos"]) {
      await page.goto(url);
      await expectAccessible(page, url);
    }

    await setupStudentWithClassToday(page, testInfo, {
      name: "Lia Acessível",
      slug: `a11y-${scheme}`,
      subject: "Biologia",
    });
    await expectAccessible(page, "semestre");

    await page
      .getByRole("main")
      .getByRole("link", { name: /Biologia/ })
      .click();
    await expect(page.getByTestId("calendario")).toBeVisible();
    await expectAccessible(page, "matéria (calendário)");
    // Um dia selecionado com registro: botões de ação, status e editor de detalhes.
    await page
      .getByTestId("dia-selecionado")
      .getByRole("button", { name: "Faltei", exact: true })
      .click();
    await expect(page.getByText("Falta registrada.")).toBeVisible();
    await page.getByRole("button", { name: "Motivo e atestado" }).click();
    await expectAccessible(page, "matéria (falta registrada e editor aberto)");
    const subjectPath = await realPath(page);

    await page.goto(`${subjectPath}/editar`);
    await expectAccessible(page, "editar matéria");

    for (const url of [
      "/",
      "/hoje",
      "/semestres",
      "/conta",
      "/avisos",
      "/compartilhar",
      "/semestres/importar",
      "/semestres/suap",
    ]) {
      await page.goto(url);
      await expectAccessible(page, url);
    }
  });
}

test("tema escolhido no app vale mesmo com o aparelho no outro tema", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await setupStudentWithClassToday(page, testInfo, {
    name: "Teo Tema",
    slug: "tema",
    subject: "Artes",
  });
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await paper()).toBe("rgb(255, 255, 255)");

  await page.goto("/conta");
  const aparencia = page.getByRole("region", { name: "Aparência" });
  await expect(aparencia.getByRole("radio", { name: "Automático" })).toBeChecked();
  await aparencia.getByText("Escuro", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await paper()).toBe("rgb(25, 25, 25)");
  await expectAccessible(page, "conta (tema escuro escolhido)");

  // Continua escuro ao recarregar e nas outras telas (sem piscar o claro).
  await page.goto("/hoje");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await paper()).toBe("rgb(25, 25, 25)");

  // Claro fixo com o aparelho no escuro.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/conta");
  await page.getByRole("region", { name: "Aparência" }).getByText("Claro", { exact: true }).click();
  expect(await paper()).toBe("rgb(255, 255, 255)");

  // Automático volta a seguir o aparelho.
  await page
    .getByRole("region", { name: "Aparência" })
    .getByText("Automático", { exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(await paper()).toBe("rgb(25, 25, 25)");
});

test("troca rápida de tema no rodapé da barra lateral", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "celular", "a barra lateral só aparece no computador");
  await page.emulateMedia({ colorScheme: "light" });
  await setupStudentWithClassToday(page, testInfo, {
    name: "Rui Rápido",
    slug: "tema-rapido",
    subject: "Música",
  });
  const sidebar = page.getByRole("complementary").filter({ has: page.getByText("Presenças") });
  await expect(sidebar.getByRole("radio", { name: "Tema automático" })).toBeChecked();

  await sidebar.locator('label[title="Escuro"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(sidebar.getByRole("radio", { name: "Tema escuro" })).toBeChecked();
  await expectAccessible(page, "barra lateral no tema escuro");

  // A mesma escolha aparece na página Conta.
  await page.goto("/conta");
  await expect(
    page.getByRole("region", { name: "Aparência" }).getByRole("radio", { name: "Escuro" }),
  ).toBeChecked();

  await page.getByRole("complementary").locator('label[title="Automático"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("troca rápida de tema no topo da tela do celular", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "celular", "no computador a troca fica na barra lateral");
  await page.emulateMedia({ colorScheme: "light" });
  await setupStudentWithClassToday(page, testInfo, {
    name: "Cora Celular",
    slug: "tema-celular",
    subject: "Teatro",
  });
  const header = page.locator("header").first();
  await expect(header.getByRole("radio", { name: "Tema automático" })).toBeChecked();
  await header.locator('label[title="Escuro"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectAccessible(page, "topo do celular no tema escuro");
  await header.locator('label[title="Claro"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
