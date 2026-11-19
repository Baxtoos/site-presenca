import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailer, MAIL_RELAY_SECRET_HEADER, RelayMailer } from "./transport";

const message = { to: "aluno@exemplo.com", subject: "Assunto", html: "<p>Oi</p>", text: "Oi" };

afterEach(() => vi.unstubAllGlobals());

describe("RelayMailer", () => {
  it("manda a mensagem ao app web com o segredo no cabeçalho", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await new RelayMailer("https://app.exemplo/interno/email", "segredo").send(message, {
      idempotencyKey: "k1",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://app.exemplo/interno/email");
    expect(init.method).toBe("POST");
    expect(init.headers[MAIL_RELAY_SECRET_HEADER]).toBe("segredo");
    expect(JSON.parse(init.body)).toEqual({ ...message, idempotencyKey: "k1" });
  });

  it("falha com o motivo quando o app recusa", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"não autorizado"}', { status: 401 })),
    );
    await expect(new RelayMailer("https://app.exemplo/x", "errado").send(message)).rejects.toThrow(
      /401.*não autorizado/,
    );
  });

  it("createMailer exige endereço e segredo", () => {
    expect(() => createMailer({ transport: "relay", from: "a@b.c" })).toThrow(/API_PROXY_SECRET/);
    expect(
      createMailer({ transport: "relay", from: "a@b.c", relayUrl: "https://x", relaySecret: "s" }),
    ).toBeInstanceOf(RelayMailer);
  });
});
