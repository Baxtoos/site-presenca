import { expect, test } from "@playwright/test";
import { setupStudentWithClassToday } from "./setup-helpers";

test("sem internet: a marcação fica guardada, pode ser trocada e é enviada quando a conexão volta", async ({
  page,
  context,
}, testInfo) => {
  await setupStudentWithClassToday(page, testInfo, {
    name: "Elisa Offline",
    slug: "offline",
    subject: "Química",
  });
  await page.getByRole("link", { name: "Hoje", exact: true }).click();
  const aula = page.getByTestId("aula").filter({ hasText: "Química" });
  await expect(aula).toContainText("Ainda pode faltar 18 tempos");

  await context.setOffline(true);
  await aula.getByRole("button", { name: "Faltei", exact: true }).click();
  await expect(page.getByText(/Sem conexão: fica guardado/)).toBeVisible();
  await expect(aula).toContainText("Faltei · não enviado");
  await expect(aula).toContainText("conta quando for enviado");
  const aviso = page.getByTestId("aviso-offline");
  await expect(aviso).toContainText("Sem conexão.");
  await expect(aviso).toContainText("1 registro guardado");

  // Trocar de ideia ainda offline: troca o que vai ser enviado (não cria outro).
  await aula.getByRole("button", { name: "Faltei parcial" }).click();
  await expect(aula).toContainText("Faltei 1 de 2 · não enviado");
  await expect(aviso).toContainText("1 registro guardado");

  // A conexão volta: envia sozinho e a lista mostra o que a API gravou.
  await context.setOffline(false);
  await expect(page.getByText("1 registro enviado.")).toBeVisible();
  await expect(aviso).toHaveCount(0);
  await expect(aula).toContainText("Faltei 1 de 2");
  await expect(aula).not.toContainText("não enviado");
  await expect(aula).toContainText("Ainda pode faltar 17 tempos");

  // Gravou uma vez só, com o último status escolhido.
  await aula.getByRole("link", { name: "Química" }).click();
  await expect(page.getByTestId("registro")).toHaveCount(1);
  await expect(page.getByTestId("registro")).toContainText("Faltei 1 de 2");
});

test("app instalado: abre sem internet as páginas já visitadas e mostra o aviso nas outras", async ({
  page,
  context,
}, testInfo) => {
  await setupStudentWithClassToday(page, testInfo, {
    name: "Fabio Instalado",
    slug: "sw",
    subject: "Biologia",
  });
  await page.goto("/hoje");
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await navigator.serviceWorker.getRegistration()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  });
  // O service worker só existe no build de produção (como no CI). Em `next dev` ele fica desligado.
  test.skip(!registered && !process.env.CI, "service worker desligado em next dev");
  expect(registered, "service worker registrado").toBe(true);

  // Espera o SW assumir a página e recarrega para a navegação passar por ele (e ficar guardada).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
      );
    }
  });
  await page.reload();
  await expect(page.getByTestId("aula").filter({ hasText: "Biologia" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  const aula = page.getByTestId("aula").filter({ hasText: "Biologia" });
  await expect(aula).toBeVisible();
  await aula.getByRole("button", { name: "Faltei", exact: true }).click();
  await expect(aula).toContainText("Faltei · não enviado");

  // Página nunca aberta neste aparelho: aviso de sem conexão (sem dados de ninguém).
  await page.goto("/conta");
  await expect(page.getByRole("heading", { name: "Sem conexão" })).toBeVisible();

  // A marcação sobreviveu à troca de página e vai quando a internet volta.
  await context.setOffline(false);
  await page.goto("/hoje");
  await expect(page.getByTestId("aula").filter({ hasText: "Biologia" })).toContainText(
    "Ainda pode faltar 16 tempos",
  );
  await expect(page.getByTestId("aviso-offline")).toHaveCount(0);
});

test("botão Fui da notificação registra a presença sem abrir o app", async ({
  page,
  context,
}, testInfo) => {
  await setupStudentWithClassToday(page, testInfo, {
    name: "Nina Notificação",
    slug: "push-acao",
    subject: "Sociologia",
  });
  await page.goto("/hoje");
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(await navigator.serviceWorker.getRegistration());
  });
  test.skip(!registered && !process.env.CI, "service worker desligado em next dev");

  // A aula de hoje, como o worker manda no lembrete.
  const today = (await (await page.request.get("/api/v1/today")).json()) as {
    date: string;
    classes: { subject: { id: string; name: string }; scheduleId: string }[];
  };
  const aula = today.classes.find((c) => c.subject.name === "Sociologia")!;
  const classes = [
    {
      subjectId: aula.subject.id,
      scheduleId: aula.scheduleId,
      classDate: today.date,
      name: "Sociologia",
    },
  ];

  // O mesmo código que o toque em "Fui" roda, dentro do service worker (com o cookie da sessão).
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const result = await sw.evaluate(
    (c) =>
      (
        self as unknown as {
          markFromNotification: (
            c: unknown,
            s: string,
          ) => Promise<{ ok: boolean; done?: number; already?: number }>;
        }
      ).markFromNotification(c, "present"),
    classes,
  );
  expect(result).toEqual({ ok: true, done: 1, already: 0 });
  // Tocar de novo não duplica: a mesma chave devolve a resposta original (um registro só).
  expect(
    await sw.evaluate(
      (c) =>
        (
          self as unknown as {
            markFromNotification: (
              c: unknown,
              s: string,
            ) => Promise<{ ok: boolean; done?: number; already?: number }>;
          }
        ).markFromNotification(c, "present"),
      classes,
    ),
  ).toEqual({ ok: true, done: 1, already: 0 });

  await page.reload();
  const card = page.getByTestId("aula").filter({ hasText: "Sociologia" });
  await expect(card).toContainText("Compareci");
});
