import { createHash, timingSafeEqual } from "node:crypto";
import { MAIL_RELAY_SECRET_HEADER, type Mailer, SmtpMailer } from "@presenca/emails/transport";
import { z } from "zod";

/**
 * Repasse de e-mail da API (ver RelayMailer em @presenca/emails/transport).
 *
 * O Render gratuito bloqueia a saída nas portas de SMTP; a Vercel não. A API manda a mensagem para
 * esta rota com o segredo do repasse (MAIL_RELAY_SECRET, o mesmo nos dois lados) e daqui ela sai
 * por SMTP. Sem o segredo certo, nada é enviado: a rota não é um relay aberto.
 */
const bodySchema = z.object({
  to: z.email(),
  subject: z.string().min(1).max(300),
  html: z.string().min(1).max(200_000),
  text: z.string().min(1).max(100_000),
  idempotencyKey: z.string().max(200).optional(),
});

export interface MailRelayConfig {
  secret?: string;
  smtpUrl?: string;
  from?: string;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compara em tempo constante (os hashes têm sempre o mesmo tamanho). */
function sameSecret(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handleMailRelay(
  request: Request,
  config: MailRelayConfig,
  createMailer: (smtpUrl: string, from: string) => Mailer = (url, from) =>
    new SmtpMailer(url, from),
): Promise<Response> {
  if (!config.secret) return json(503, { error: "repasse de e-mail não configurado" });
  const received = request.headers.get(MAIL_RELAY_SECRET_HEADER);
  if (!received || !sameSecret(received, config.secret)) {
    return json(401, { error: "não autorizado" });
  }
  if (!config.smtpUrl || !config.from) {
    return json(503, { error: "SMTP_URL e MAIL_FROM precisam estar configuradas no app web" });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return json(400, { error: "mensagem inválida" });
  }

  const { idempotencyKey, ...message } = body;
  try {
    await createMailer(config.smtpUrl, config.from).send(message, { idempotencyKey });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`repasse de e-mail falhou: ${detail}`);
    return json(502, { error: `o servidor SMTP recusou: ${detail}` });
  }
  return json(202, { status: "enviado" });
}
