"use client";

import type { SessionsResponse } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useOffline } from "@/components/offline-provider";
import { api, ApiError } from "@/lib/api-client";
import { clearOfflineData } from "@/lib/offline-cache";
import { plural } from "@/lib/format";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const offline = useOffline();
  return (
    <Button
      variant="secondary"
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
        void api("/v1/auth/logout", { method: "POST" })
          .catch(() => undefined)
          // Páginas guardadas e fila offline têm dados desta conta: não ficam no aparelho.
          .then(() => clearOfflineData(offline.userId).catch(() => undefined))
          .then(() => {
            router.replace("/entrar");
            router.refresh();
          });
      }}
    >
      Sair
    </Button>
  );
}

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">("idle");
  const [error, setError] = useState<string>();
  return (
    <div className="grid min-w-0 gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-4 text-sm [overflow-wrap:anywhere] sm:flex sm:items-center sm:justify-between">
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
    <section
      className="grid gap-3 rounded-2xl border border-line bg-surface p-6"
      aria-labelledby="sessoes"
    >
      <div className="grid gap-1">
        <h2 id="sessoes" className="font-semibold">
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

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED = "presenca:install-dismissed";

/**
 * Convite para instalar o app. Android/Chrome/Edge: botão que abre o diálogo do navegador.
 * iPhone (Safari não tem esse diálogo): explica o caminho pelo menu Compartilhar.
 * Some se o app já está instalado ou se a pessoa dispensou.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_DISMISSED) === "1";
    } catch {
      dismissed = false;
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (dismissed || standalone) return;

    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    // Leitura única de ambiente na montagem (não dá para saber isso no servidor).
    setIos(isIos);
    if (isIos) setHidden(false);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || (!ios && !deferred)) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED, "1");
    } catch {
      // Sem armazenamento: o convite volta na próxima visita, sem problema.
    }
  };

  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm"
      aria-label="Instalar o app"
    >
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Instale o app</strong>
        {ios
          ? ": no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Ele abre em tela cheia e funciona sem internet."
          : " para marcar as aulas com um toque, direto da tela inicial, mesmo sem internet."}
      </p>
      <div className="flex gap-2">
        {deferred ? (
          <Button
            type="button"
            onClick={() => {
              void deferred.prompt();
              void deferred.userChoice.then(() => setDeferred(null));
            }}
          >
            Instalar
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={dismiss}>
          Agora não
        </Button>
      </div>
    </section>
  );
}
