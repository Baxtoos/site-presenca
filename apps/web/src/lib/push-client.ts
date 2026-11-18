"use client";

import { api, ApiError } from "./api-client";

/** Push precisa de service worker (build de produção), PushManager e permissão de notificação. */
export function pushSupport(): "ok" | "unsupported" | "ios-needs-install" {
  if (typeof window === "undefined") return "unsupported";
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // No iPhone, push só existe com o app instalado na tela de início (iOS 16.4+).
  if (isIos && !standalone) return "ios-needs-install";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  return "ok";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null;
  return navigator.serviceWorker.ready;
}

/** A inscrição de push deste aparelho, se houver. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export class PushSetupError extends Error {}

/**
 * Pede permissão, inscreve o aparelho no serviço de push do navegador e registra na API.
 * Se o endereço estava em outra conta (aparelho compartilhado), refaz a inscrição uma vez.
 */
export async function enablePush(vapidPublicKey: string): Promise<number> {
  const reg = await registration();
  if (!reg) {
    throw new PushSetupError(
      "As notificações no celular funcionam no app publicado (o service worker não roda em desenvolvimento).",
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushSetupError(
      permission === "denied"
        ? "As notificações estão bloqueadas para este site. Libere nas configurações do navegador."
        : "Você precisa permitir as notificações para ativar.",
    );
  }
  const subscribe = async () => {
    try {
      return await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    } catch (e) {
      // Aba anônima do Chrome, navegador sem serviço de push, ou permissão revogada no meio.
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        throw new PushSetupError(
          "As notificações estão bloqueadas para este site. Libere nas configurações do navegador.",
        );
      }
      throw new PushSetupError(
        "Este navegador não conseguiu ativar as notificações. Em aba anônima isso não funciona; tente numa janela normal do Chrome, Edge, Firefox ou Safari.",
      );
    }
  };
  let sub = (await reg.pushManager.getSubscription()) ?? (await subscribe());
  const send = (s: PushSubscription) =>
    api<{ pushDevices: number }>("/v1/push-subscriptions", { method: "POST", body: s.toJSON() });
  try {
    return (await send(sub)).pushDevices;
  } catch (e) {
    if (e instanceof ApiError && e.code === "PUSH_ENDPOINT_IN_USE") {
      await sub.unsubscribe();
      sub = await subscribe();
      return (await send(sub)).pushDevices;
    }
    throw e;
  }
}

/** Desliga o push neste aparelho (no navegador e na API). */
export async function disablePushOnThisDevice(): Promise<number | null> {
  const sub = await currentPushSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  const result = await api<{ pushDevices: number }>("/v1/push-subscriptions", {
    method: "DELETE",
    body: { endpoint },
  });
  return result.pushDevices;
}
