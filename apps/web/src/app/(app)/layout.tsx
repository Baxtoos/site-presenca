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
import { UserIcon } from "@/components/icons";
import { ThemeSwitcher } from "@/components/theme-picker";
import { ToastProvider } from "@/components/toast";
import { apiGet, getMe } from "@/lib/api-server";
import { MobileTabBar, Sidebar } from "./shell";

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
                  className="rounded-md px-1.5 py-1 text-base font-semibold tracking-tight hover:bg-surface-2 lg:hidden"
                >
                  Presenças
                </Link>
                <span className="flex-1 lg:hidden" />
                {/* Celular: a barra lateral (com a troca de tema) não aparece. */}
                <div className="lg:hidden">
                  <ThemeSwitcher name="tema-topo" showLabel={false} />
                </div>
                <NotificationBell unread={unreadCount} />
                {/* Celular: a Conta saiu das abas de baixo para caber Tarefas e Notas. */}
                <Link
                  href="/conta"
                  aria-label="Conta"
                  className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
                >
                  <UserIcon size={20} />
                </Link>
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
