import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { getMe } from "@/lib/api-server";
import { LogoutButton } from "./home-client";
import { NavLink } from "./nav-link";

/** Área logada: confere a sessão na API e mostra a navegação. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/entrar");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <Link
            href="/"
            className="mr-1 flex shrink-0 items-center gap-2 font-semibold sm:mr-2"
            aria-label="Início"
          >
            <span
              className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-accent-ink"
              aria-hidden
            >
              P
            </span>
          </Link>
          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1"
            aria-label="Principal"
          >
            <NavLink href="/" exact>
              Início
            </NavLink>
            <NavLink href="/hoje">Hoje</NavLink>
            <NavLink href="/semestres">Semestres</NavLink>
            <NavLink href="/conta">Conta</NavLink>
          </nav>
          <LogoutButton />
        </div>
      </header>
      <ToastProvider>
        <main className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-28 pt-6">
          {children}
        </main>
      </ToastProvider>
    </div>
  );
}
