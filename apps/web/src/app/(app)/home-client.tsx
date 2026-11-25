"use client";

import type { SessionsResponse } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LogoutIcon } from "@/components/icons";
import { Alert, Button } from "@/components/ui";
import { useOffline } from "@/components/offline-provider";
import { api, ApiError } from "@/lib/api-client";
import { clearOfflineData } from "@/lib/offline-cache";
import { disablePushOnThisDevice } from "@/lib/push-client";
import { plural } from "@/lib/format";

export function LogoutButton({ variant = "secondary" }: { variant?: "secondary" | "ghost" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const offline = useOffline();
  return (
    <Button
      variant={variant === "ghost" ? "ghost" : "secondary"}
      loading={pending}
      onClick={() => {
        const unsent = offline.pending.length;
        if (
          unsent > 0 &&
          !window.confirm(
            `${plural(unsent, "registro ainda não foi enviado", "registros ainda não foram enviados")}. Se sair agora, ${unsent === 1 ? "ele será descartado" : "eles serão descartados"}. Sair mesmo assim?`,
          )
        ) {
          return;
        }
        setPending(true);
        // Este aparelho para de receber os avisos desta conta (antes de a sessão acabar).
        void disablePushOnThisDevice()
          .catch(() => undefined)
          .then(() => api("/v1/auth/logout", { method: "POST" }))
          .catch(() => undefined)
          // Páginas guardadas e fila offline têm dados desta conta: não ficam no aparelho.
          .then(() => clearOfflineData(offline.userId).catch(() => undefined))
          .then(() => {
            router.replace("/entrar");
            router.refresh();
          });
      }}
    >
      {variant === "ghost" ? <LogoutIcon size={18} /> : null}
      Sair
    </Button>
  );
}

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">("idle");
  const [error, setError] = useState<string>();
  return (
    <div className="grid min-w-0 gap-3 rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm [overflow-wrap:anywhere] sm:flex sm:items-center sm:justify-between">
      <p>
        <strong className="font-semibold">Confirme seu e-mail.</strong> Mandamos um link para{" "}
        {email}. Sem a confirmação, os alertas de faltas por e-mail ficam desligados.
      </p>
      {state === "sent" ? (
        <p className="font-medium text-ok" role="status">
          Link reenviado.
        </p>
      ) : (
        <Button
          variant="secondary"
          className="shrink-0"
          loading={state === "pending"}
          onClick={() => {
            setState("pending");
            api("/v1/auth/verify-email/resend", { method: "POST" })
              .then(() => setState("sent"))
              .catch((e: unknown) => {
                setError(e instanceof ApiError ? e.message : "Não foi possível reenviar.");
                setState("error");
              });
          }}
        >
          Reenviar link
        </Button>
      )}
      {state === "error" && error ? <p className="text-fail sm:basis-full">{error}</p> : null}
    </div>
  );
}

/** Descreve o dispositivo pelo User-Agent, de forma simples e legível. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo desconhecido";
  const os = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad/i.test(userAgent)
      ? "iPhone/iPad"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Mac OS/i.test(userAgent)
          ? "Mac"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  return [browser, os].filter(Boolean).join(" no ") || userAgent.slice(0, 40);
}

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionsResponse["sessions"]>();
  const [error, setError] = useState<string>();
  const [revoking, setRevoking] = useState<string>();

  const load = useCallback(async () => {
    try {
      setSessions((await api<SessionsResponse>("/v1/me/sessions")).sessions);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar as sessões.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await api(`/v1/me/sessions/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível encerrar a sessão.");
    } finally {
      setRevoking(undefined);
    }
  }

  return (
    <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="sessoes">
      <div className="grid gap-1">
        <h2 id="sessoes" className="text-lg font-semibold tracking-tight">
          Onde você está conectado
        </h2>
        <p className="text-sm text-muted">Encerre qualquer sessão que você não reconheça.</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {sessions === undefined && !error ? <p className="text-sm text-muted">Carregando…</p> : null}
      <ul className="grid divide-y divide-line">
        {sessions?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-3">
            <div className="grid gap-0.5 text-sm">
              <span className="font-medium">
                {describeDevice(s.userAgent)}
                {s.current ? (
                  <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                    este dispositivo
                  </span>
                ) : null}
              </span>
              <span className="text-muted">
                Último acesso: {dateTime.format(new Date(s.lastSeenAt))}
              </span>
            </div>
            {s.current ? null : (
              <Button
                variant="danger"
                loading={revoking === s.id}
                onClick={() => void revoke(s.id)}
              >
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
