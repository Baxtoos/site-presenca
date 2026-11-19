import type { LoginResponse } from "@presenca/contracts";
import { withNext } from "@/lib/next-path";

/** A rota abriu a sessão ou pediu o segundo fator? */
export const needsMfa = (result: unknown): boolean =>
  typeof result === "object" && result !== null && "mfaRequired" in result;

/** Para onde ir depois de uma rota de login: o app, ou a tela do código do segundo fator. */
export function afterLogin(result: LoginResponse | undefined, next: string | null): string {
  if (needsMfa(result)) return withNext("/entrar/verificacao", next);
  return next ?? "/";
}
