/**
 * Os transportes de e-mail ficam em @presenca/emails/transport (a API e o worker usam os mesmos).
 * Aqui só o token de injeção do Nest.
 */
export {
  CaptureMailer,
  LogMailer,
  type MailMessage,
  type Mailer,
  ResendMailer,
  SmtpMailer,
} from "@presenca/emails/transport";

export const MAILER = Symbol("MAILER");
