import { describe, expect, it } from "vitest";
import { magicLinkMessage, resetPasswordMessage, verifyEmailMessage } from "./action-email";

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
