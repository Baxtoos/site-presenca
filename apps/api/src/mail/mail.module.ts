import { Global, Logger, Module } from "@nestjs/common";
import { createMailer } from "@presenca/emails/transport";
import { ENV, type Env } from "../config/env";
import { MAILER, type Mailer } from "./mailer";

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Mailer => {
        const logger = new Logger("LogMailer");
        return createMailer({
          transport: env.MAIL_TRANSPORT,
          from: env.MAIL_FROM,
          smtpUrl: env.SMTP_URL,
          resendApiKey: env.RESEND_API_KEY,
          log: (line) => logger.log(line),
        });
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
