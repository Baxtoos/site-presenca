export {
  CaptureMailer,
  LogMailer,
  type MailMessage,
  type Mailer,
  ResendMailer,
  SmtpMailer,
} from "@presenca/emails/transport";

export const MAILER = Symbol("MAILER");
