import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra o segredo TOTP com AES-256-GCM antes de ir para o banco. Quem copiar o banco (ou um
 * backup) não consegue gerar códigos sem a chave, que fica só na API (MFA_ENCRYPTION_KEY).
 * Formato: iv (12 bytes) + tag (16) + texto cifrado. O id da conta entra como dado associado:
 * o segredo de uma conta não serve se for colado na linha de outra.
 */
export function encryptSecret(key: Buffer, userId: string, secret: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptSecret(key: Buffer, userId: string, data: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
