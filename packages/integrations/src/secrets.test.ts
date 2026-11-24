import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  maskUrl,
  openSecret,
  parseIntegrationKey,
  sealSecret,
  SecretError,
  secretAad,
} from "./secrets";

const key = randomBytes(32);
const aad = secretAad("01a20ab4-4a44-7eee-bcd5-9288a954bc90", "ics_url");

describe("cifragem das credenciais", () => {
  it("abre o que fechou; cada cifra é diferente (IV aleatório)", () => {
    const secret = "https://moodle.exemplo.edu.br/calendar/export_execute.php?authtoken=abc";
    const a = sealSecret(secret, key, aad);
    const b = sealSecret(secret, key, aad);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("authtoken");
    expect(openSecret(a, key, aad)).toBe(secret);
  });

  it("chave errada, outra conta, outro campo ou cifra adulterada falham", () => {
    const sealed = sealSecret("token-123", key, aad);
    expect(() => openSecret(sealed, randomBytes(32), aad)).toThrow(SecretError);
    expect(() => openSecret(sealed, key, secretAad("outra-conta", "ics_url"))).toThrow(SecretError);
    expect(() =>
      openSecret(sealed, key, secretAad("01a20ab4-4a44-7eee-bcd5-9288a954bc90", "wstoken")),
    ).toThrow(SecretError);
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => openSecret(tampered, key, aad)).toThrow(SecretError);
    expect(() => openSecret("v2.xxx", key, aad)).toThrow(SecretError);
  });

  it("a chave precisa ter 32 bytes; sem chave a integração fica desligada", () => {
    expect(parseIntegrationKey(undefined)).toBeNull();
    expect(parseIntegrationKey(key.toString("base64"))?.length).toBe(32);
    expect(() => parseIntegrationKey(randomBytes(16).toString("base64"))).toThrow(SecretError);
  });

  it("mostra só o domínio do link", () => {
    expect(maskUrl("https://moodle.exemplo.edu.br/x?authtoken=abc")).toBe("moodle.exemplo.edu.br");
  });
});
