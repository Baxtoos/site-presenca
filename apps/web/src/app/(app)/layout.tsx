import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  notificationListSchema,
  semestersResponseSchema,
  subjectsResponseSchema,
} from "@presenca/contracts";
import { NotificationBell } from "@/components/notifications/bell";
import { OfflineProvider } from "@/components/offline-provider";
import { ToastProvider } from "@/components/toast";
import { apiGet, getMe } from "@/lib/api-server";
import { AppMark, MobileTabBar, Sidebar } from "./shell";

/**
 * Área logada no estilo de um espaço de trabalho: barra lateral com a navegação e as matérias do
 * semestre (computador), topo enxuto e abas embaixo (celular). Confere a sessão na API.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/entrar");
  const [{ unreadCount }, { semesters }] = await Promise.all([
    apiGet("/v1/notifications?limit=1", notificationListSchema),
    apiGet("/v1/semesters", semestersResponseSchema),
  ]);
  const current = semesters.find((s) => s.isCurrent) ?? null;
  const subjects = current
    ? (await apiGet(`/v1/semesters/${current.id}/subjects`, subjectsResponseSchema)).subjects
    : [];

  return (
    <ToastProvider>
      <OfflineProvider userId={me.id}>
        <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
          <Sidebar
            firstName={me.fullName.split(" ")[0] ?? ""}
            unread={unreadCount}
            semesterLabel={current?.label ?? null}
            subjects={subjects.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          />
          <div className="min-w-0">
            <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur">
              <div className="flex h-12 items-center gap-2 px-3 pt-[env(safe-area-inset-top)] sm:px-5 lg:justify-end">
                <Link
                  href="/"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-surface-2 lg:hidden"
                >
                  <AppMark size={26} />
                  Presenças
                </Link>
                <span className="flex-1 lg:hidden" />
                <NotificationBell unread={unreadCount} />
              </div>
            </header>
            <main className="mx-auto grid w-full max-w-[50rem] grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-32 pt-4 sm:px-8 lg:px-12 lg:pb-24 lg:pt-8">
              {children}
            </main>
          </div>
        </div>
        <MobileTabBar />
      </OfflineProvider>
    </ToastProvider>
  );
}
