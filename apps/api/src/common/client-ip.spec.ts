import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, resolveClientIp } from "./client-ip";

const SECRET = "s".repeat(40);

function fakeRequest(headers: Record<string, string>): FastifyRequest {
  return { ip: "104.23.209.66", headers: { ...headers } } as unknown as FastifyRequest;
}

describe("resolveClientIp", () => {
  it("usa o IP do app web quando o segredo confere, e apaga os cabeçalhos", () => {
    const req = fakeRequest({ [CLIENT_IP_HEADER]: "179.153.1.2", [PROXY_SECRET_HEADER]: SECRET });
    expect(resolveClientIp(req, SECRET)).toBe("179.153.1.2");
    expect(req.headers[PROXY_SECRET_HEADER]).toBeUndefined();
    expect(req.headers[CLIENT_IP_HEADER]).toBeUndefined();
  });

  it("aceita IPv6", () => {
    const req = fakeRequest({ [CLIENT_IP_HEADER]: "2804:14c::1", [PROXY_SECRET_HEADER]: SECRET });
    expect(resolveClientIp(req, SECRET)).toBe("2804:14c::1");
  });

  it("ignora o cabeçalho com segredo errado, sem segredo ou sem configuração", () => {
    const forged = { [CLIENT_IP_HEADER]: "1.2.3.4" };
    expect(resolveClientIp(fakeRequest(forged), SECRET)).toBe("104.23.209.66");
    expect(
      resolveClientIp(fakeRequest({ ...forged, [PROXY_SECRET_HEADER]: "errado" }), SECRET),
    ).toBe("104.23.209.66");
    expect(
      resolveClientIp(fakeRequest({ ...forged, [PROXY_SECRET_HEADER]: SECRET }), undefined),
    ).toBe("104.23.209.66");
  });

  it("ignora valor que não é IP", () => {
    const req = fakeRequest({
      [CLIENT_IP_HEADER]: "1.2.3.4, 5.6.7.8",
      [PROXY_SECRET_HEADER]: SECRET,
    });
    expect(resolveClientIp(req, SECRET)).toBe("104.23.209.66");
  });
});
