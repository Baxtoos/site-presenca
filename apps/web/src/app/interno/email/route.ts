import { handleMailRelay } from "@/lib/mail-relay";

/** Repasse de e-mail da API (ver lib/mail-relay.ts). Só aceita chamadas com o segredo compartilhado. */
export async function POST(request: Request) {
  return handleMailRelay(request, {
    secret: process.env.API_PROXY_SECRET,
    smtpUrl: process.env.SMTP_URL,
    from: process.env.MAIL_FROM,
  });
}
