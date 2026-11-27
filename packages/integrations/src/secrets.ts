import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Credenciais de integração (link .ics com authtoken, wstoken do Moodle) cifradas em repouso com
 * AES-256-GCM. O texto guardado é "v1." + base64url(iv | tag | cifra). O AAD amarra o segredo à
 * conta e ao campo: copiar a cifra para outra linha ou outro campo faz a abertura falhar.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretError extends Error {
  override name = "SecretError";
}

export function parseIntegrationKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) {
    throw new SecretError("INTEGRATION_ENCRYPTION_KEY precisa ter 32 bytes em base64.");
  }
  return key;
}

export function sealSecret(plaintext: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, body]).toString("base64url")}`;
}

export function openSecret(sealed: string, key: Buffer, aad: string): string {
  const [version, payload] = sealed.split(".", 2);
  if (version !== VERSION || !payload) throw new SecretError("formato de segredo desconhecido");
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new SecretError("segredo truncado");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretError("não foi possível abrir o segredo (chave ou conta diferentes)");
  }
}

export const secretAad = (userId: string, field: "ics_url" | "wstoken") =>
  `moodle:${userId}:${field}`;

export function maskUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "link inválido";
  }
}
