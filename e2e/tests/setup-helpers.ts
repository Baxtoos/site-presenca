import { expect, type Page, type TestInfo } from "@playwright/test";
import { waitForLink } from "./mailpit";

export const WEEKDAYS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** Hoje no fuso do aluno (o padrão da conta é America/Sao_Paulo), como "AAAA-MM-DD". */
export function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export const uniqueEmail = (testInfo: TestInfo, slug: string) =>
  `e2e.${slug}.${testInfo.project.name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@presenca.local`;

/** Abre o link do e-mail no mesmo endereço do teste (o e-mail usa WEB_ORIGIN). */
export async function openEmailLink(page: Page, link: string) {
  const url = new URL(link);
  await page.goto(`${url.pathname}${url.search}`);
}

/**
 * Preenche o cadastro (a página /cadastro já aberta), confere o "confira seu e-mail" e abre o
 * link de confirmação, que cria a conta e entra nela.
 */
export async function signUp(
  page: Page,
  opts: { name: string; email: string; password: string },
): Promise<void> {
  const requestedAt = new Date(Date.now() - 1_000);
  await page.getByLabel("Nome").fill(opts.name);
  await page.getByLabel("E-mail").fill(opts.email);
  await page.getByLabel("Senha", { exact: true }).fill(opts.password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Confira seu e-mail.")).toBeVisible();
  await openEmailLink(
    page,
    await waitForLink(opts.email, "Confirme seu e-mail para criar a conta", requestedAt),
  );
}

/**
 * Conta nova + semestre em volta de hoje + uma matéria com aula de 2 tempos no dia da semana de
 * hoje (limite de 18 tempos). Termina no semestre, com o card da matéria visível.
 */
export async function setupStudentWithClassToday(
  page: Page,
  testInfo: TestInfo,
  opts: { name: string; slug: string; subject: string; email?: string },
): Promise<string> {
  const today = todayInSaoPaulo();
  await page.goto("/cadastro");
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await signUp(page, {
    name: opts.name,
    email: opts.email ?? uniqueEmail(testInfo, opts.slug),
    password: `senha-forte-${opts.slug}-e2e`,
  });

  await page.getByRole("link", { name: "Criar meu semestre" }).click();
  await expect(page.getByRole("heading", { name: "Semestres", exact: true })).toBeVisible();
  await page.getByLabel("Nome").fill("Atual");
  await page.getByLabel("Início das aulas").fill(shift(today, -60));
  await page.getByLabel("Fim das aulas").fill(shift(today, 60));
  await page.getByRole("button", { name: "Criar semestre" }).click();
  await expect(page.getByRole("heading", { name: /^Atual/ })).toBeVisible();
  await page.getByRole("link", { name: "Adicionar matéria" }).click();
  await expect(page.getByRole("heading", { name: "Nova matéria" })).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill(opts.subject);
  await page.getByRole("button", { name: "Adicionar horário" }).click();
  await page
    .getByRole("combobox", { name: "Dia", exact: true })
    .selectOption(String(isoWeekday(today)));
  await page.getByRole("button", { name: "Salvar matéria" }).click();
  await expect(
    page.getByRole("main").getByRole("link", { name: new RegExp(opts.subject) }),
  ).toBeVisible();
  return today;
}

/**
 * Caminho real da tela. A barra de endereço é mascarada (apps/web/src/lib/url-mask.ts) e mostra
 * só "/", então page.url() não serve; a URL real fica no estado do histórico.
 */
export async function realPath(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = window.history.state as { __presencaUrl?: string } | null;
    return state?.__presencaUrl ?? location.pathname + location.search;
  });
}

export async function expectPath(page: Page, pattern: RegExp): Promise<void> {
  await expect.poll(() => realPath(page)).toMatch(pattern);
}
