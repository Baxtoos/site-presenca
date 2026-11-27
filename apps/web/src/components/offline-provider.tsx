"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";
import { registerServiceWorker, rememberUser } from "@/lib/offline-cache";
import {
  flushQueue,
  idbStore,
  markBody,
  type PendingMark,
  type SendFailure,
  withSyncLock,
} from "@/lib/offline-queue";
import { formatDayLabel, plural } from "@/lib/format";

const CHANGED = "presenca:queue-changed";
const RETRY_MS = 30_000;

interface OfflineContextValue {
  userId: string;
  online: boolean;
  syncing: boolean;
  pending: PendingMark[];
  enqueue: (mark: Omit<PendingMark, "userId" | "createdAt">) => Promise<void>;
  replace: (key: string, next: Pick<PendingMark, "status" | "unitsMissed">) => Promise<string>;
  discard: (key: string) => Promise<void>;
  syncNow: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline precisa estar dentro de <OfflineProvider>");
  return ctx;
}

function announce() {
  window.dispatchEvent(new Event(CHANGED));
  try {
    const channel = new BroadcastChannel(CHANGED);
    channel.postMessage("changed");
    channel.close();
  } catch {}
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function toFailure(error: unknown): SendFailure {
  if (error instanceof ApiError) {
    return { status: error.problem.status, code: error.code, message: error.message };
  }
  return { status: 0, code: "NETWORK_ERROR", message: "Sem conexão." };
}

export function OfflineProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<PendingMark[]>([]);
  const [syncing, setSyncing] = useState(false);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const store = useMemo(() => (typeof indexedDB === "undefined" ? null : idbStore()), []);
  const syncingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!store) return;
    const all = await store.all().catch(() => []);
    setPending(all.filter((m) => m.userId === userId));
  }, [store, userId]);

  const syncNow = useCallback(async () => {
    if (!store || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await withSyncLock(() =>
        flushQueue(
          store,
          userId,
          async (mark) => {
            await api("/v1/attendance", {
              method: "POST",
              body: markBody(mark),
              idempotencyKey: mark.key,
            });
          },
          toFailure,
        ),
      );
      if (result.sent.length > 0 || result.rejected.length > 0) announce();
      if (result.sent.length > 0) {
        toast.push({
          tone: "success",
          message: `${plural(result.sent.length, "registro enviado", "registros enviados")}.`,
        });
        router.refresh();
      }
      for (const { mark, message } of result.rejected) {
        toast.push({
          tone: "error",
          message: `${mark.subjectName} (${formatDayLabel(mark.classDate)}) não foi registrada: ${message}`,
        });
      }
      if (result.stopped === "auth") {
        toast.push({
          tone: "error",
          message: "Sua sessão expirou. Entre de novo para enviar os registros guardados.",
        });
      }
    } catch {
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [store, userId, toast, router]);

  useEffect(() => {
    void registerServiceWorker().catch(() => undefined);
    void rememberUser(userId)
      .catch(() => undefined)
      .then(reload)
      .then(syncNow);
  }, [userId, reload, syncNow]);

  useEffect(() => {
    const onChange = () => void reload();
    window.addEventListener(CHANGED, onChange);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANGED);
      channel.onmessage = onChange;
    } catch {
      channel = null;
    }
    return () => {
      window.removeEventListener(CHANGED, onChange);
      channel?.close();
    };
  }, [reload]);

  useEffect(() => {
    const trigger = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", trigger);
    return () => {
      window.removeEventListener("online", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [syncNow]);

  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setInterval(() => void syncNow(), RETRY_MS);
    return () => clearInterval(timer);
  }, [pending.length, syncNow]);

  const enqueue = useCallback<OfflineContextValue["enqueue"]>(
    async (mark) => {
      if (!store) throw new Error("Este navegador não permite guardar dados offline.");
      await store.put({ ...mark, userId, createdAt: Date.now() });
      announce();
    },
    [store, userId],
  );

  const replace = useCallback<OfflineContextValue["replace"]>(
    async (key, next) => {
      if (!store) throw new Error("Este navegador não permite guardar dados offline.");
      const current = (await store.all()).find((m) => m.key === key);
      const newKey = crypto.randomUUID();
      if (current) {
        await store.delete(key);
        await store.put({ ...current, ...next, key: newKey });
      }
      announce();
      return newKey;
    },
    [store],
  );

  const discard = useCallback<OfflineContextValue["discard"]>(
    async (key) => {
      await store?.delete(key);
      announce();
    },
    [store],
  );

  const value = useMemo(
    () => ({ userId, online, syncing, pending, enqueue, replace, discard, syncNow }),
    [userId, online, syncing, pending, enqueue, replace, discard, syncNow],
  );

  return (
    <OfflineContext.Provider value={value}>
      <OfflineBanner />
      {children}
    </OfflineContext.Provider>
  );
}

function OfflineBanner() {
  const { online, pending, syncing, syncNow } = useOffline();
  if (online && pending.length === 0) return null;
  return (
    <div role="status" className="border-b border-warn/40 bg-warn-soft" data-testid="aviso-offline">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <p>
          {online ? null : <strong className="font-semibold">Sem conexão. </strong>}
          {pending.length > 0
            ? `${plural(pending.length, "registro guardado", "registros guardados")} neste aparelho, ${
                online
                  ? "esperando envio"
                  : pending.length === 1
                    ? "enviado quando a internet voltar"
                    : "enviados quando a internet voltar"
              }.`
            : "Você pode marcar as aulas normalmente; os registros são enviados quando a internet voltar."}
        </p>
        {online && pending.length > 0 ? (
          <button
            type="button"
            disabled={syncing}
            onClick={() => void syncNow()}
            className="min-h-9 rounded-lg px-3 font-semibold text-accent hover:bg-accent-soft disabled:opacity-60"
          >
            {syncing ? "Enviando…" : "Enviar agora"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
