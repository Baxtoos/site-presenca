import type { ErrorEvent } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { initErrorReporting, reportError, scrubEvent } from "./index";

describe("scrubEvent", () => {
  it("tira corpo, cookies, cabeçalhos sensíveis, usuário e e-mails", () => {
    const raw: ErrorEvent = {
      type: undefined,
      message: "falhou para aluna@exemplo.com",
      user: { id: "1", ip_address: "1.2.3.4", email: "aluna@exemplo.com" },
      request: {
        url: "https://api/x",
        data: { password: "segredo" },
        cookies: { presenca_session: "token" },
        query_string: "token=abc",
        headers: {
          cookie: "presenca_session=token",
          authorization: "Bearer x",
          "x-presenca-proxy-secret": "s",
          "user-agent": "Firefox",
        },
      },
      exception: { values: [{ type: "Error", value: "SMTP recusou bob@exemplo.org" }] },
      breadcrumbs: [{ message: "envio para c@d.com", data: { body: "x" } }],
    };
    const event = scrubEvent(raw);
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: "https://api/x", headers: { "user-agent": "Firefox" } });
    expect(event.message).toBe("falhou para <e-mail>");
    expect(event.exception?.values?.[0]?.value).toBe("SMTP recusou <e-mail>");
    expect(event.breadcrumbs?.[0]).toEqual({ message: "envio para <e-mail>" });
  });
});

describe("sem SENTRY_DSN", () => {
  it("não liga nada e reportError não faz nada", () => {
    expect(initErrorReporting({ dsn: undefined, service: "api", environment: "test" })).toBe(false);
    expect(() => reportError(new Error("x"))).not.toThrow();
  });
});
