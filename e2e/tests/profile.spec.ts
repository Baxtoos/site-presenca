import { expect, test } from "@playwright/test";
import { setupStudentWithClassToday } from "./setup-helpers";

test("troca o nome, a instituição e o curso na página Conta", async ({ page }, testInfo) => {
  await setupStudentWithClassToday(page, testInfo, {
    name: "Nome Antigo",
    slug: "perfil",
    subject: "Qualquer",
  });
  await page.goto("/conta");
  const perfil = page.getByRole("region", { name: "Seu perfil" });
  await expect(perfil.getByLabel("Nome", { exact: true })).toHaveValue("Nome Antigo");

  await perfil.getByLabel("Nome", { exact: true }).fill("   ");
  await perfil.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(perfil.getByText("Informe seu nome.")).toBeVisible();

  await perfil.getByLabel("Nome", { exact: true }).fill("Sérgio Bastos");
  await perfil.getByLabel("Instituição (opcional)").fill("IFSP Câmpus Salto");
  await perfil.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Perfil salvo.")).toBeVisible();
  await expect(page.getByRole("main").locator("header").first()).toContainText("Sérgio Bastos");

  await page.reload();
  await expect(perfil.getByLabel("Nome", { exact: true })).toHaveValue("Sérgio Bastos");
  await expect(perfil.getByLabel("Instituição (opcional)")).toHaveValue("IFSP Câmpus Salto");
});
