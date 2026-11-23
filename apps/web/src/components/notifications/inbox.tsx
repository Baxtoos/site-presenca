"use client";

import type { NotificationItem, NotificationList, UnreadCount } from "@presenca/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";

const KIND_STYLE: Record<NotificationItem["kind"], string> = {
  threshold: "bg-warn",
  checkin_reminder: "bg-accent",
  system: "bg-muted",
  task_due: "bg-crit",
};

/** "há 5 min", "ontem, 21:00", "12/11, 19:30". */
function when(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `hoje, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `ontem, ${time}`;
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}, ${time}`;
}

/** Central de avisos: lista, marcar como lido (ao abrir) e marcar todos. */
export function Inbox({ initial }: { initial: NotificationList }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial.items);
  const [unread, setUnread] = useState(initial.unreadCount);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [source, setSource] = useState(initial);
  const [loading, setLoading] = useState(false);

  if (source !== initial) {
    setSource(initial);
    setItems(initial.items);
    setUnread(initial.unreadCount);
    setCursor(initial.nextCursor);
  }

  async function markRead(item: NotificationItem) {
    if (item.readAt) return;
    setItems((all) =>
      all.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
    );
    try {
      const { unreadCount } = await api<UnreadCount>(`/v1/notifications/${item.id}/read`, {
        method: "POST",
      });
      setUnread(unreadCount);
      router.refresh();
    } catch {
      // Marcar como lido não é crítico; na próxima visita tenta de novo.
    }
  }

  async function markAll() {
    try {
      await api<UnreadCount>("/v1/notifications/read-all", { method: "POST" });
      setItems((all) => all.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
      setUnread(0);
      router.refresh();
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível marcar.",
      });
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api<NotificationList>(
        `/v1/notifications?cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((all) => [...all, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível carregar.",
      });
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="grid gap-2 rounded-xl border border-dashed border-line bg-surface p-6 text-sm">
        <p className="font-medium">Nenhum aviso por enquanto.</p>
        <p className="text-muted">
          Quando uma matéria chegar a 50%, 75%, 90% ou 100% do limite de faltas, o aviso aparece
          aqui (e por e-mail ou no celular, se você ligar em Conta).
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          {unread === 0 ? "Tudo lido." : `${unread} não ${unread === 1 ? "lido" : "lidos"}.`}
        </p>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => void markAll()}
            className="min-h-9 rounded-lg px-3 font-semibold text-accent hover:bg-accent-soft"
          >
            Marcar todos como lidos
          </button>
        ) : null}
      </div>
      <ul className="grid gap-2" aria-label="Avisos">
        {items.map((item) => (
          <li key={item.id} data-testid="aviso">
            <Link
              href={item.url}
              onClick={() => void markRead(item)}
              className={`relative grid gap-1 rounded-xl border p-4 pl-5 transition-colors hover:border-accent/50 ${
                item.readAt ? "border-line bg-surface" : "border-accent/30 bg-accent-soft"
              }`}
            >
              <span
                className={`absolute inset-y-3 left-0 w-1 rounded-r ${KIND_STYLE[item.kind]}`}
                aria-hidden
              />
              <span className="flex items-start justify-between gap-3">
                <strong className="font-semibold">{item.title}</strong>
                <span className="shrink-0 text-xs text-muted">{when(item.createdAt)}</span>
              </span>
              <span className="text-sm text-muted">{item.body}</span>
              {item.readAt ? null : <span className="sr-only">Não lido.</span>}
            </Link>
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          onClick={() => void loadMore()}
          className="w-fit"
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
