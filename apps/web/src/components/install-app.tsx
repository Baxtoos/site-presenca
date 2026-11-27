"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PhoneIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { registerServiceWorker } from "@/lib/offline-cache";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type Platform = "ios" | "android" | "desktop";

function useDevice(): { platform: Platform; standalone: boolean } | null {
  const [device, setDevice] = useState<{ platform: Platform; standalone: boolean } | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    setDevice({
      platform: /iPad|iPhone|iPod/.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "desktop",
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    void registerServiceWorker().catch(() => undefined);
  }, []);
  return device;
}

const HOW_TO: Record<Platform, string> = {
  ios: "No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.",
  android: "No Chrome, abra o menu ⋮ e toque em “Instalar app” (ou “Adicionar à tela inicial”).",
  desktop:
    "No Chrome ou no Edge, clique no ícone de instalar na barra de endereço (ou no menu ⋮ → “Instalar Monitor de Presenças”).",
};

const DISMISSED = "presenca:install-dismissed";
const DISMISS_DAYS = 30;

export function InstallApp({ variant }: { variant: "landing" | "signup" | "home" | "header" }) {
  const device = useDevice();
  const canPrompt = useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (variant !== "home") return;
    try {
      const at = Number(localStorage.getItem(DISMISSED) ?? 0);
      setDismissed(Date.now() - at < DISMISS_DAYS * 86_400_000);
    } catch {
      setDismissed(false);
    }
  }, [variant]);

  if (!device || device.standalone || dismissed) return null;

  const install = () => {
    const event = deferred;
    if (!event) return;
    void event.prompt();
    void event.userChoice.then(() => {
      deferred = null;
      emit();
    });
  };
  if (variant === "header") {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          canPrompt
            ? install()
            : document
                .getElementById("app")
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      >
        <PhoneIcon size={16} />
        <span className="hidden sm:inline">Instalar app</span>
        <span className="sm:hidden">App</span>
      </Button>
    );
  }

  const action = canPrompt ? (
    <Button type="button" onClick={install}>
      <PhoneIcon size={16} />
      Instalar o app
    </Button>
  ) : null;
  const howTo = canPrompt ? null : <p className="text-sm text-muted">{HOW_TO[device.platform]}</p>;

  if (variant === "signup") {
    return (
      <section
        className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm"
        aria-label="Também é um app"
        data-testid="instalar-app"
      >
        <PhoneIcon size={20} className="shrink-0 text-accent" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p>
            <strong className="font-semibold">Também é um app.</strong> Instale no celular ou no
            computador e abra direto da tela inicial, mesmo sem internet.
          </p>
          {howTo}
        </div>
        {action}
      </section>
    );
  }

  if (variant === "home") {
    const dismiss = () => {
      setDismissed(true);
      try {
        localStorage.setItem(DISMISSED, String(Date.now()));
      } catch {}
    };
    return (
      <section
        className="grid gap-3 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm sm:flex sm:flex-wrap sm:items-center"
        aria-label="Instalar o app"
        data-testid="instalar-app"
      >
        <div className="grid min-w-0 flex-1 gap-1">
          <p>
            <strong className="font-semibold">O Monitor de Presenças também é um app.</strong>{" "}
            Instalado, ele abre em tela cheia direto da tela inicial, avisa por notificação e marca
            as aulas mesmo sem internet.
          </p>
          {howTo}
        </div>
        <div className="flex flex-wrap gap-2">
          {action}
          <Button type="button" variant="secondary" onClick={dismiss}>
            Agora não
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-3" data-testid="instalar-app">
      {action}
      {howTo}
    </div>
  );
}
