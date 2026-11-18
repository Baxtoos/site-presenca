/** Lê os e-mails capturados pelo Mailpit (http://localhost:8025) pela API HTTP dele. */
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MessageSummary {
  ID: string;
  Subject: string;
  Created: string;
}

/**
 * Espera chegar um e-mail para o endereço com o assunto informado, criado depois de `since`,
 * e devolve o link com token que está nele.
 */
export async function waitForLink(
  to: string,
  subject: string,
  since: Date,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`);
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${query}`)).json()) as {
      messages: MessageSummary[];
    };
    const message = search.messages.find((m) => new Date(m.Created) >= since);
    if (message) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Text: string;
      };
      const link = full.Text.match(/https?:\/\/\S+?token=[A-Za-z0-9_-]{43}/)?.[0];
      if (!link) throw new Error(`e-mail "${subject}" sem link com token`);
      return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`nenhum e-mail "${subject}" para ${to} em ${timeoutMs} ms`);
}
