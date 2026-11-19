import { handleMailRelay } from "@/lib/mail-relay";

/**
 * Repasse de e-mail da API (ver lib/mail-relay.ts). Só aceita chamadas com o segredo do repasse
 * (MAIL_RELAY_SECRET; sem ele, o API_PROXY_SECRET da configuração antiga).
 */
export async function POST(request: Request) {
  return handleMailRelay(request, {
    secret: process.env.MAIL_RELAY_SECRET || process.env.API_PROXY_SECRET,
    smtpUrl: process.env.SMTP_URL,
    from: process.env.MAIL_FROM,
  });
}
