import { expect, test } from "@playwright/test";
import { setupStudentWithClassToday } from "./setup-helpers";

/**
 * Content-Security-Policy com nonce (apps/web/src/lib/csp.ts): sem 'unsafe-inline' em scripts,
 * um nonce novo a cada resposta e nenhum script do próprio app bloqueado pela política.
 */
test("CSP com nonce: nada do app é bloqueado e o nonce muda a cada página", async ({
  page,
}, testInfo) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(
        `Content Security Policy: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`,
      );
    });
  });

  const first = await page.goto("/entrar");
  const policy = first?.headers()["content-security-policy"] ?? "";
  const scriptSrc = policy.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]{20,}'/);
  expect(scriptSrc).not.toContain("'unsafe-inline'");

  const second = await page.goto("/entrar");
  const nonceOf = (p: string) => /'nonce-([^']+)'/.exec(p)?.[1];
  expect(nonceOf(second?.headers()["content-security-policy"] ?? "")).not.toBe(nonceOf(policy));

  // Uso normal: cadastro, semestre, matéria, calendário, tema e máscara da barra.
  await setupStudentWithClassToday(page, testInfo, {
    name: "Sofia Segura",
    slug: "csp",
    subject: "Direito",
  });
  await page
    .getByRole("main")
    .getByRole("link", { name: /Direito/ })
    .click();
  await expect(page.getByTestId("calendario")).toBeVisible();
  await page.goto("/conta");
  await page
    .getByRole("region", { name: "Aparência" })
    .getByText("Escuro", { exact: true })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  expect(violations).toEqual([]);
});
