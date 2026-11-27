import { expect, test } from "@playwright/test";
import { setupStudentWithClassToday } from "./setup-helpers";

test("deixa claro que também é um app e mostra como instalar (apresentação, cadastro e Início)", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByText("Site e app: celular e computador")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Instale no celular ou no computador" }),
  ).toBeVisible();
  const landing = page.getByTestId("instalar-app");
  await expect(landing).toBeVisible();
  await expect(landing).toContainText(/Instalar|Compartilhar|menu ⋮|barra de endereço/);
  await page.getByRole("banner").getByRole("button", { name: /app/i }).click();
  await expect(landing).toBeInViewport();

  await page.goto("/cadastro");
  await expect(page.getByTestId("instalar-app")).toContainText("Também é um app.");

  await setupStudentWithClassToday(page, testInfo, {
    name: "Ivo Instala",
    slug: "instala",
    subject: "Química",
  });
  await page.goto("/");
  const home = page.getByTestId("instalar-app");
  await expect(home).toContainText("O Monitor de Presenças também é um app.");
  await home.getByRole("button", { name: "Agora não" }).click();
  await expect(home).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Olá/ })).toBeVisible();
  await expect(page.getByTestId("instalar-app")).toHaveCount(0);
});
