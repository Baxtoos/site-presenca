"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PhoneIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { registerServiceWorker } from "@/lib/offline-cache";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// O navegador avisa uma vez só que dá para instalar ("beforeinstallprompt"), às vezes antes de
// o componente montar: guarda o evento no módulo, que carrega com a página.
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

/** Aparelho e se o app já está aberto como app instalado (leitura única, só no navegador). */
function useDevice(): { platform: Platform; standalone: boolean } | null {
  const [device, setDevice] = useState<{ platform: Platform; standalone: boolean } | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    // Leitura única de ambiente na montagem (não dá para saber isso no servidor).
    setDevice({
      platform: /iPad|iPhone|iPod/.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "desktop",
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    // Sem o service worker, o navegador não oferece a instalação (fora da área logada também).
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

/**
 * Mostra que o sistema também é um app e oferece instalar. Com o diálogo do navegador
 * (Android, Chrome, Edge), um botão abre a instalação; sem ele (iPhone, Firefox), explica o
 * caminho. Some quando o site já está aberto como app.
 * - `landing`: bloco da página de apresentação;
 * - `signup`: aviso curto no cadastro;
 * - `home`: convite no Início, que dá para dispensar por 30 dias.
 */
export function InstallApp({ variant }: { variant: "landing" | "signup" | "home" }) {
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
      // Leitura única do armazenamento na montagem.
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
      } catch {
        // Sem armazenamento: o convite volta na próxima visita, sem problema.
      }
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
