"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { needsMfa } from "@/lib/mfa";
import { withNext } from "@/lib/next-path";

export function ConsumeToken({
  token,
  endpoint,
  redirectTo,
  pendingText,
  successContent,
  failureExtra,
}: {
  token: string;
  endpoint: "/v1/auth/magic-link/consume" | "/v1/auth/verify-email" | "/v1/auth/register/confirm";
  redirectTo?: string;
  pendingText: string;
  successContent?: ReactNode;
  failureExtra?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<
    { status: "pending" | "done" } | { status: "failed"; message: string }
  >({
    status: "pending",
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, "", pathname);
    api<unknown>(endpoint, { method: "POST", body: { token } })
      .then((result) => {
        if (needsMfa(result)) {
          router.replace(
            withNext("/entrar/verificacao", redirectTo && redirectTo !== "/" ? redirectTo : null),
          );
        } else if (redirectTo) {
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
  }, [endpoint, pathname, redirectTo, router, token]);

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
