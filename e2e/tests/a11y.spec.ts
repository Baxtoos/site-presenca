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

    for (const url of ["/entrar", "/cadastro", "/esqueci-senha", "/privacidade", "/termos"]) {
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

    for (const url of ["/", "/hoje", "/semestres", "/conta", "/avisos", "/compartilhar"]) {
      await page.goto(url);
      await expectAccessible(page, url);
    }
  });
}
