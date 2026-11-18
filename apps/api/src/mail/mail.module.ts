import { Global, Module } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { LogMailer, MAILER, type Mailer, ResendMailer, SmtpMailer } from "./mailer";

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Mailer => {
        switch (env.MAIL_TRANSPORT) {
          case "smtp":
            return new SmtpMailer(env.SMTP_URL!, env.MAIL_FROM);
          case "resend":
            return new ResendMailer(env.RESEND_API_KEY!, env.MAIL_FROM);
          case "log":
            return new LogMailer();
        }
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
