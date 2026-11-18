import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Envio de e-mail. A implementação é escolhida por MAIL_TRANSPORT. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol("MAILER");

/** SMTP (Mailpit em desenvolvimento, ou qualquer provedor SMTP). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** API HTTP do Resend. A chave de idempotência evita e-mail duplicado em retentativas. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ from: this.from, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`);
    }
  }
}

/** Só imprime no log (com o texto, que contém o link). Proibido em produção pela validação do ambiente. */
export class LogMailer implements Mailer {
  private readonly logger = new Logger("LogMailer");

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`E-mail para ${message.to} — ${message.subject}\n${message.text}`);
  }
}

/** Guarda os e-mails em memória. Usado nos testes para ler os links enviados. */
export class CaptureMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Último e-mail enviado para o endereço, ou undefined. */
  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}
