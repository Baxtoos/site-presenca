const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MessageSummary {
  ID: string;
  Subject: string;
  Created: string;
}

export async function waitForEmail(
  to: string,
  subject: string,
  since: Date,
  timeoutMs = 15_000,
): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`);
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${query}`)).json()) as {
      messages: MessageSummary[];
    };
    const message = search.messages.find((m) => new Date(m.Created) >= since);
    if (message) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Subject: string;
        Text: string;
        HTML: string;
      };
      return { subject: full.Subject, text: full.Text, html: full.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`nenhum e-mail "${subject}" para ${to} em ${timeoutMs} ms`);
}

export async function waitForLink(
  to: string,
  subject: string,
  since: Date,
  timeoutMs = 15_000,
): Promise<string> {
  const { text } = await waitForEmail(to, subject, since, timeoutMs);
  const link = text.match(/https?:\/\/\S+?token=[A-Za-z0-9_-]{43}/)?.[0];
  if (!link) throw new Error(`e-mail "${subject}" sem link com token`);
  return link;
}
