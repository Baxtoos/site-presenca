import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectPath, setupStudentWithClassToday } from "./setup-helpers";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "..", "fixtures", "suap", name), "utf8");

async function fakeSuap(page: Page, state: { absentOn?: string }) {
  await page.context().route("https://suap.ifsp.edu.br/**", (route) => {
    const url = new URL(route.request().url());
    const tab = url.searchParams.get("tab");
    let body: string | null = null;
    if (url.pathname === "/edu/aluno/SL0000000/") body = fixture("aluno.html");
    if (url.pathname === "/edu/aluno/SL0000000/boletins/") body = fixture("boletins.html");
    if (url.pathname === "/edu/detalhar_matricula_diario_boletim/1/397554/")
      body = fixture("detalhar-397554.html");
    const turma = /^\/edu\/sala_virtual\/(\d+)\/$/.exec(url.pathname)?.[1];
    if (turma) body = fixture(`turma-${turma}-${tab === "aulas" ? "aulas" : "geral"}.html`);
    if (body && turma === "397554" && tab === "aulas" && state.absentOn) {
      body = body.replace(
        new RegExp(
          `(<td>${state.absentOn}</td>[\\s\\S]*?)<span class="status status-info">0</span>`,
        ),
        '$1<span class="status status-error">4</span>',
      );
    }
    return body === null
      ? route.fulfill({ status: 404, body: "não encontrado" })
      : route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: { "x-frame-options": "SAMEORIGIN" },
          body,
        });
  });
}

async function runBookmarklet(page: Page, code: string): Promise<Page> {
  const script = await (await page.request.get("/suap.js")).text();
  await page.context().route(
    (url) => url.pathname === "/suap.js",
    (route) => route.fulfill({ contentType: "text/javascript", body: script }),
  );
  const suap = await page.context().newPage();
  await suap.goto("https://suap.ifsp.edu.br/edu/aluno/SL0000000/?tab=boletim");
  const opened = page.context().waitForEvent("page");
  await suap.evaluate(code);
  const monitor = await opened;
  await monitor.waitForURL(/\/semestres\/importar/);
  await suap.close();
  return monitor;
}

test("traz do SUAP as disciplinas, o horário e as faltas, e atualiza depois", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await setupStudentWithClassToday(page, testInfo, {
    name: "Aluna SUAP",
    slug: "suap",
    subject: "Outra",
  });
  const state: { absentOn?: string } = {};
  await fakeSuap(page, state);

  await page.goto("/semestres");
  await page.getByRole("link", { name: "Conectar ao SUAP" }).click();
  await expect(page.getByRole("heading", { name: "Conectar ao SUAP" })).toBeVisible();
  if (testInfo.project.name === "celular") {
    await expect(page.getByRole("tab", { name: "Chrome (Android)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("suap-guia").locator(":scope > li")).toHaveCount(5);
    await page.getByRole("tab", { name: "iPhone" }).click();
    await expect(page.getByTestId("suap-guia")).toContainText("Adicionar Favorito");
    await page.getByRole("tab", { name: "Firefox" }).click();
    await expect(page.getByTestId("suap-guia")).toContainText("não roda favoritos");
  } else {
    await expect(page.getByRole("tab", { name: "Computador" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  const favorite = page.getByTestId("suap-favorito");
  await expect(favorite).toHaveAttribute("href", /^javascript:/);
  const href = (await favorite.getAttribute("href"))!;
  expect(href.length).toBeLessThan(600);
  const code = decodeURIComponent(href.slice("javascript:".length));

  let monitor = await runBookmarklet(page, code);
  await expect(monitor.getByRole("heading", { name: "Período 2026/2" })).toBeVisible();
  await expect(monitor.getByTestId("suap-resumo")).toContainText(
    "2 disciplinas · 21 aulas lançadas",
  );
  await expect(monitor.getByTestId("suap-disciplina")).toHaveCount(2);
  await expect(monitor.getByLabel("Onde colocar")).toHaveValue("new");
  await monitor.getByRole("button", { name: "Criar semestre" }).click();
  await expect(monitor.getByRole("heading", { name: /^2026\.2/ })).toBeVisible();
  await expectPath(monitor, /^\/semestres\/[0-9a-f-]{36}$/);
  const main = monitor.getByRole("main");
  const eso = main.getByRole("link", { name: /Engenharia de Software 1/ });
  const bd = main.getByRole("link", { name: /Bancos de Dados 2/ });
  await expect(eso).toContainText("4 de 19 faltas");
  await expect(eso).toContainText("Ter");
  await expect(bd).toContainText("6 de 20 faltas");
  await expect(bd).toContainText("Qui");
  await eso.click();
  const official = monitor.getByTestId("nota-suap");
  await expect(official).toContainText("Nota oficial do SUAP");
  await expect(official).toContainText("Etapa 17,5");
  await expect(official).toContainText("Média7,5");
  await expect(official).toContainText("Situação: Cursando");
  await expect(official.getByRole("list", { name: "Avaliações no SUAP" })).toContainText("A1");
  await expect(official.getByRole("list", { name: "Avaliações no SUAP" })).toContainText("9,1");
  await monitor.getByRole("button", { name: "Trazer avaliações do SUAP" }).click();
  await expect(monitor.getByLabel("Fórmula", { exact: true })).toHaveValue("A1");
  await monitor.getByRole("button", { name: "Salvar regra" }).click();
  await expect(monitor.getByText("Regra de cálculo salva.")).toBeVisible();
  const a1 = monitor.getByTestId("avaliacao").filter({ hasText: "A1" });
  await expect(a1).toContainText("do SUAP");
  await expect(a1.getByRole("textbox").first()).toHaveValue("9,1");
  await monitor.close();

  state.absentOn = "25/08/2026";
  monitor = await runBookmarklet(page, code);
  await expect(monitor.getByLabel("Onde colocar")).not.toHaveValue("new");
  await monitor.getByRole("button", { name: "Atualizar semestre" }).click();
  await expect(monitor.getByText(/SUAP em dia: 0 aulas novas, 1 corrigida/)).toBeVisible();
  await expect(
    monitor.getByRole("main").getByRole("link", { name: /Engenharia de Software 1/ }),
  ).toContainText("8 de 19 faltas");
});
