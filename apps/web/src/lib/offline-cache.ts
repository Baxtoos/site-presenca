"use client";

import { idbStore } from "./offline-queue";

const PAGES_CACHE = "presenca-pages";
const LAST_USER_KEY = "presenca:last-user";

export const SW_ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW === "1";

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (!SW_ENABLED) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    return;
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

export async function clearPagesCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(PAGES_CACHE);
}

export async function rememberUser(userId: string): Promise<void> {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_USER_KEY);
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {}
  if (last !== userId) await clearPagesCache();
}

export async function clearOfflineData(userId: string): Promise<void> {
  await clearPagesCache();
  const store = idbStore();
  const marks = await store.all();
  await Promise.all(marks.filter((m) => m.userId === userId).map((m) => store.delete(m.key)));
}
