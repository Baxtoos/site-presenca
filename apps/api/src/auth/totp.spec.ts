import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, otpauthUrl, totpCode, verifyTotp } from "./totp";

// Vetores do RFC 6238 (apêndice B), segredo ASCII "12345678901234567890", SHA-1, 8 dígitos;
// os 6 dígitos finais são o código de 6 dígitos.
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (seconds, code) => {
    expect(totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
  });

  it("aceita um passo de diferença no relógio, não dois", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now, null)).toBeNull();
  });

  it("recusa reaproveitar um código já usado (ou mais antigo)", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
  });

  it("recusa formato diferente de 6 dígitos", () => {
    expect(verifyTotp(RFC_SECRET, "12345", Date.now(), null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", Date.now(), null)).toBeNull();
  });

  it("base32 vai e volta e monta o otpauth://", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb oi").toString()).toBe("foobar");
    const url = otpauthUrl(RFC_SECRET, "ana@exemplo.com");
    expect(url).toMatch(/^otpauth:\/\/totp\/Monitor%20de%20Presen%C3%A7as%3Aana%40exemplo\.com\?/);
    expect(url).toContain(`secret=${base32Encode(RFC_SECRET)}`);
  });
});
