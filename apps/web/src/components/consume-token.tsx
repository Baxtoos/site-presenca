"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

/**
 * Consome um token de link assim que a página abre (verificar e-mail, magic link).
 * Tira o token da barra de endereço na hora, para não ficar no histórico.
 */
export function ConsumeToken({
  token,
  endpoint,
  redirectTo,
  pendingText,
  successContent,
  failureExtra,
}: {
  token: string;
  endpoint: "/v1/auth/magic-link/consume" | "/v1/auth/verify-email";
  /** Para onde ir depois do sucesso. Sem valor, mostra successContent. */
  redirectTo?: string;
  pendingText: string;
  successContent?: ReactNode;
  /** Conteúdo extra abaixo da mensagem de erro (ex.: formulário para pedir novo link). */
  failureExtra?: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    { status: "pending" | "done" } | { status: "failed"; message: string }
  >({
    status: "pending",
  });
  // O efeito roda duas vezes em desenvolvimento (Strict Mode); o link só pode ser consumido uma.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    api(endpoint, { method: "POST", body: { token } })
      .then(() => {
        if (redirectTo) {
          router.replace(redirectTo);
          router.refresh();
        } else {
          setState({ status: "done" });
        }
      })
      .catch((e: unknown) => {
        setState({
          status: "failed",
          message: e instanceof ApiError ? e.message : "Algo deu errado.",
        });
      });
  }, [endpoint, redirectTo, router, token]);

  if (state.status === "failed") {
    return (
      <div className="grid gap-4">
        <Alert tone="error">{state.message}</Alert>
        {failureExtra}
      </div>
    );
  }
  if (state.status === "done") return <>{successContent}</>;
  return (
    <Alert>
      <span className="inline-flex items-center gap-2">
        <span
          className="size-4 animate-spin rounded-full border-2 border-accent border-r-transparent"
          aria-hidden
        />
        {pendingText}
      </span>
    </Alert>
  );
}
