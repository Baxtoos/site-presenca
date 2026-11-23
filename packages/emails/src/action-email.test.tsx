import { describe, expect, it } from "vitest";
import {
  accountExistsMessage,
  magicLinkMessage,
  noticeMessage,
  resetPasswordMessage,
  taskDueMessage,
  verifyEmailMessage,
} from "./action-email";

const URL_WITH_TOKEN = "https://app.exemplo/redefinir-senha?token=abc&x=<y>";

describe("e-mails de autenticação", () => {
  it("trazem o link no botão e em texto, com o HTML escapado", () => {
    const msg = resetPasswordMessage({ url: URL_WITH_TOKEN });
    expect(msg.subject).toBe("Redefinir sua senha");
    expect(msg.html).toContain(
      'href="https://app.exemplo/redefinir-senha?token=abc&amp;x=&lt;y&gt;"',
    );
    expect(msg.html).not.toContain("<y>");
    expect(msg.text).toContain(`Escolher nova senha: ${URL_WITH_TOKEN}`);
  });

  it("o botão ocupa a célula colorida e o endereço de reserva também é link", () => {
    const msg = verifyEmailMessage({
      name: "Ana",
      url: "https://app.exemplo/cadastro/confirmar?token=t",
    });
    const links = msg.html.match(
      /<a [^>]*href="https:\/\/app\.exemplo\/cadastro\/confirmar\?token=t"/g,
    );
    // Botão + endereço de reserva clicável.
    expect(links).toHaveLength(2);
    expect(msg.html).toMatch(/<td[^>]*bgcolor="#0B6BCB"[^>]*>\s*<a /);
    expect(msg.html).toContain('target="_blank"');
  });

  it("escapam o nome do usuário", () => {
    const msg = verifyEmailMessage({ name: "<b>Ana</b>", url: "https://app.exemplo/v" });
    expect(msg.html).toContain("Olá, &lt;b&gt;Ana&lt;/b&gt;.");
  });

  it("magic link muda o texto quando cria conta", () => {
    expect(magicLinkMessage({ url: "https://a/b", newAccount: true }).subject).toBe(
      "Crie sua conta",
    );
    expect(magicLinkMessage({ url: "https://a/b", newAccount: false }).subject).toBe(
      "Seu link de acesso",
    );
  });
});

describe("aviso do app", () => {
  it("usa o título como assunto, traz o texto, o link e onde desligar", () => {
    const email = noticeMessage({
      name: "Ana <script>",
      title: "Cálculo II: 75% do limite de faltas",
      body: "Você tem 14 de 18 faltas. Ainda pode faltar 4 aulas.",
      url: "https://app.exemplo/materias/1",
      settingsUrl: "https://app.exemplo/conta",
    });
    expect(email.subject).toBe("Cálculo II: 75% do limite de faltas");
    expect(email.html).toContain("Ainda pode faltar 4 aulas");
    expect(email.html).toContain('href="https://app.exemplo/materias/1"');
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("https://app.exemplo/conta");
  });
});

describe("visual dos e-mails", () => {
  it("usa a paleta do app, sem imagens, com texto de prévia", () => {
    const msg = resetPasswordMessage({ url: "https://app.exemplo/r?token=x" });
    expect(msg.html).toContain("background-color:#0B6BCB");
    expect(msg.html).toContain("color:#37352F");
    expect(msg.html).not.toMatch(/<img/i);
    // Prévia na caixa de entrada: a primeira frase que não é a saudação.
    expect(msg.html).toContain("Recebemos um pedido para trocar a senha da sua conta.");
  });

  it("aviso de conta existente traz o link de nova senha como link secundário", () => {
    const msg = accountExistsMessage({
      loginUrl: "https://app.exemplo/entrar",
      resetUrl: "https://app.exemplo/esqueci-senha",
    });
    expect(msg.html).toContain('href="https://app.exemplo/esqueci-senha"');
    expect(msg.text).toContain("Esqueci a senha: https://app.exemplo/esqueci-senha");
  });

  it("aviso de entrega traz tarefa, matéria, prazo e o link das tarefas", () => {
    const msg = taskDueMessage({
      name: "Ana",
      title: "Lista <3>",
      subjectName: "Cálculo II",
      dueLabel: "sex., 28/11 às 23:59",
      remindLabel: "24 h",
      url: "https://app.exemplo/tarefas",
      settingsUrl: "https://app.exemplo/conta",
    });
    expect(msg.subject).toBe("Entrega em 24 h: Lista <3>");
    expect(msg.html).toContain("Lista &lt;3&gt;");
    expect(msg.html).toContain("Matéria: Cálculo II");
    expect(msg.html).toContain("Prazo: sex., 28/11 às 23:59");
    expect(msg.html).toContain('href="https://app.exemplo/tarefas"');
    expect(msg.text).toContain("Ver minhas tarefas: https://app.exemplo/tarefas");
  });
});
