import { notificationListSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "@/components/notifications/inbox";
import { apiGet } from "@/lib/api-server";

export const metadata: Metadata = { title: "Avisos · Monitor de Presenças" };

export default async function NotificationsPage() {
  const list = await apiGet("/v1/notifications?limit=20", notificationListSchema);
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Avisos</h1>
        <Link
          href="/conta#notificacoes"
          className="text-sm font-medium text-accent hover:underline"
        >
          Configurar avisos
        </Link>
      </header>
      <Inbox initial={list} />
    </>
  );
}
