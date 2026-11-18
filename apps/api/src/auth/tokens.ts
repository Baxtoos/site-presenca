import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Token aleatório de 256 bits em base64url (43 caracteres): cookie de sessão e links de e-mail. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda só o SHA-256 do token. Um vazamento do banco não dá acesso a nenhuma conta. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Comparação em tempo constante (state do OAuth). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
