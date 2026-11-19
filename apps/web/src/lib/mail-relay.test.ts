import {
  MAIL_RELAY_SECRET_HEADER,
  type MailMessage,
  type Mailer,
} from "@presenca/emails/transport";
import { describe, expect, it } from "vitest";
import { handleMailRelay } from "./mail-relay";

const SECRET = "s".repeat(32);
const config = { secret: SECRET, smtpUrl: "smtp://localhost:1025", from: "App <app@exemplo.com>" };
const message = { to: "aluno@exemplo.com", subject: "Assunto", html: "<p>Oi</p>", text: "Oi" };

function request(body: unknown, secret: string | null = SECRET): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set(MAIL_RELAY_SECRET_HEADER, secret);
  return new Request("https://app.exemplo/interno/email", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function fakeMailer(fail?: Error) {
  const sent: { url: string; from: string; message: MailMessage; key?: string }[] = [];
  const create = (url: string, from: string): Mailer => ({
    async send(m, options) {
      if (fail) throw fail;
      sent.push({ url, from, message: m, key: options?.idempotencyKey });
    },
  });
  return { sent, create };
}

describe("repasse de e-mail", () => {
  it("envia com o segredo certo, usando o SMTP e o remetente do app", async () => {
    const mailer = fakeMailer();
    const res = await handleMailRelay(
      request({ ...message, idempotencyKey: "k1" }),
      config,
      mailer.create,
    );
    expect(res.status).toBe(202);
    expect(mailer.sent).toEqual([{ url: config.smtpUrl, from: config.from, message, key: "k1" }]);
  });

  it.each([
    ["sem segredo", null],
    ["segredo errado", "x".repeat(32)],
  ])("recusa %s e não envia nada", async (_label, secret) => {
    const mailer = fakeMailer();
    const res = await handleMailRelay(request(message, secret), config, mailer.create);
    expect(res.status).toBe(401);
    expect(mailer.sent).toHaveLength(0);
  });

  it("fica fechada quando o segredo não está configurado", async () => {
    const mailer = fakeMailer();
    const res = await handleMailRelay(
      request(message, ""),
      { ...config, secret: undefined },
      mailer.create,
    );
    expect(res.status).toBe(503);
    expect(mailer.sent).toHaveLength(0);
  });

  it("avisa quando falta o SMTP no app", async () => {
    const res = await handleMailRelay(request(message), { secret: SECRET }, fakeMailer().create);
    expect(res.status).toBe(503);
  });

  it("recusa mensagem inválida", async () => {
    const res = await handleMailRelay(
      request({ ...message, to: "não-é-email" }),
      config,
      fakeMailer().create,
    );
    expect(res.status).toBe(400);
  });

  it("devolve 502 com o motivo quando o SMTP recusa", async () => {
    const mailer = fakeMailer(new Error("535 Username and Password not accepted"));
    const res = await handleMailRelay(request(message), config, mailer.create);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "o servidor SMTP recusou: 535 Username and Password not accepted",
    });
  });
});
