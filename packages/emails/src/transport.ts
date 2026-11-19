import { randomUUID } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendOptions {
  /**
   * Mesma chave = mesmo e-mail: o provedor descarta a repetição (Resend). Use o id do aviso, para
   * que uma retentativa depois de uma falha "no meio do caminho" não chegue duas vezes.
   */
  idempotencyKey?: string;
}

/** Envio de e-mail. A implementação é escolhida por MAIL_TRANSPORT. */
export interface Mailer {
  send(message: MailMessage, options?: SendOptions): Promise<void>;
}

export type MailTransportName = "smtp" | "resend" | "relay" | "log";

/** Cabeçalho com o segredo compartilhado entre a API e a rota de repasse do app web. */
export const MAIL_RELAY_SECRET_HEADER = "x-presenca-mail-secret";

/** Caminho da rota de repasse no app web (apps/web/src/app/interno/email/route.ts). */
export const MAIL_RELAY_PATH = "/interno/email";

/** SMTP (Mailpit em desenvolvimento, ou qualquer provedor SMTP). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(url);
  }

  async send(message: MailMessage, options: SendOptions = {}): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      ...message,
      ...(options.idempotencyKey ? { messageId: `<${options.idempotencyKey}@presenca>` } : {}),
    });
  }
}

/** API HTTP do Resend. A chave de idempotência evita e-mail duplicado em retentativas. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage, options: SendOptions = {}): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": options.idempotencyKey ?? randomUUID(),
      },
      body: JSON.stringify({ from: this.from, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Resend respondeu ${response.status}: ${await response.text()}`);
    }
  }
}

/**
 * Repasse por HTTPS para o app web, que envia por SMTP.
 *
 * O Render gratuito bloqueia a saída nas portas de SMTP (25, 465 e 587); HTTPS passa. A API
 * manda a mensagem para a rota interna do app (na Vercel, onde SMTP funciona) com o segredo
 * do repasse (MAIL_RELAY_SECRET), e a rota envia com SMTP_URL e MAIL_FROM.
 */
export class RelayMailer implements Mailer {
  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {}

  async send(message: MailMessage, options: SendOptions = {}): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", [MAIL_RELAY_SECRET_HEADER]: this.secret },
      body: JSON.stringify({ ...message, idempotencyKey: options.idempotencyKey }),
      // A função da Vercel pode estar fria; o envio SMTP leva alguns segundos.
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`repasse de e-mail respondeu ${response.status}: ${await response.text()}`);
    }
  }
}

/** Só imprime no log (com o texto, que contém o link). Proibido em produção pela validação do ambiente. */
export class LogMailer implements Mailer {
  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  async send(message: MailMessage): Promise<void> {
    this.log(`E-mail para ${message.to} — ${message.subject}\n${message.text}`);
  }
}

/** Guarda os e-mails em memória. Usado nos testes para ler os links enviados. */
export class CaptureMailer implements Mailer {
  readonly sent: (MailMessage & SendOptions)[] = [];

  async send(message: MailMessage, options: SendOptions = {}): Promise<void> {
    this.sent.push({ ...message, ...options });
  }

  /** Último e-mail enviado para o endereço, ou undefined. */
  lastTo(to: string): (MailMessage & SendOptions) | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

export function createMailer(config: {
  transport: MailTransportName;
  from: string;
  smtpUrl?: string;
  resendApiKey?: string;
  relayUrl?: string;
  relaySecret?: string;
  log?: (line: string) => void;
}): Mailer {
  switch (config.transport) {
    case "smtp":
      if (!config.smtpUrl) throw new Error("SMTP_URL é obrigatória com MAIL_TRANSPORT=smtp");
      return new SmtpMailer(config.smtpUrl, config.from);
    case "resend":
      if (!config.resendApiKey)
        throw new Error("RESEND_API_KEY é obrigatória com MAIL_TRANSPORT=resend");
      return new ResendMailer(config.resendApiKey, config.from);
    case "relay":
      if (!config.relayUrl || !config.relaySecret)
        throw new Error("MAIL_TRANSPORT=relay precisa do endereço do app e de MAIL_RELAY_SECRET");
      return new RelayMailer(config.relayUrl, config.relaySecret);
    case "log":
      return new LogMailer(config.log);
  }
}
