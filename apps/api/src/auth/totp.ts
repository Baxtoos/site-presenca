import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238): o código de 6 dígitos dos apps autenticadores (Google Authenticator, Authy,
 * 1Password, Microsoft Authenticator). HMAC-SHA1, passos de 30 s, como todos esses apps esperam.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Segredo novo: 160 bits, o tamanho recomendado para HMAC-SHA1. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** Base32 sem "=" (o formato que o usuário digita ou que vai no QR Code). */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("base32 inválido");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const stepAt = (epochMs: number) => Math.floor(epochMs / 1000 / STEP_SECONDS);

/** Código de um passo (HOTP com o contador = passo). */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return binary.toString().padStart(DIGITS, "0");
}

/**
 * Confere o código aceitando um passo antes e um depois (relógio do celular adiantado ou
 * atrasado em até 30 s). Devolve o passo aceito, ou null. Passos até `lastUsedStep` são
 * recusados: o mesmo código não serve duas vezes.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  epochMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(epochMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** Endereço otpauth:// do QR Code. */
export function otpauthUrl(secret: Buffer, accountEmail: string): string {
  const issuer = "Monitor de Presenças";
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
