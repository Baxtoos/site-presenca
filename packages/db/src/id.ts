import { randomBytes } from "node:crypto";

/**
 * UUID v7 (RFC 9562) gerado na aplicação, no mesmo formato de app.uuid_v7() do banco.
 * Usado quando a API precisa do id antes do INSERT (ex.: abrir a transação já como o usuário
 * que está sendo criado, para o RLS permitir a gravação).
 */
export function newId(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6); // 48 bits de timestamp em ms
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // versão 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 4122
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
