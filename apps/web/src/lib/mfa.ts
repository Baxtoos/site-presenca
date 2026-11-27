import type { LoginResponse } from "@presenca/contracts";
import { withNext } from "@/lib/next-path";

export const needsMfa = (result: unknown): boolean =>
  typeof result === "object" && result !== null && "mfaRequired" in result;

export function afterLogin(result: LoginResponse | undefined, next: string | null): string {
  if (needsMfa(result)) return withNext("/entrar/verificacao", next);
  return next ?? "/";
}
