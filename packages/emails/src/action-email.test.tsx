import { describe, expect, it } from "vitest";
import {
  magicLinkMessage,
  noticeMessage,
  resetPasswordMessage,
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
      body: "Você tem 14 de 18 faltas. Ainda pode faltar 4 tempos.",
      url: "https://app.exemplo/materias/1",
      settingsUrl: "https://app.exemplo/conta",
    });
    expect(email.subject).toBe("Cálculo II: 75% do limite de faltas");
    expect(email.html).toContain("Ainda pode faltar 4 tempos");
    expect(email.html).toContain('href="https://app.exemplo/materias/1"');
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("https://app.exemplo/conta");
  });
});
