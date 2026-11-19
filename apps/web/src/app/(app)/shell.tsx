"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import {
  BellIcon,
  HomeIcon,
  SemesterIcon,
  ShareIcon,
  TodayIcon,
  UserIcon,
} from "@/components/icons";
import { SUBJECT_COLOR_CLASS } from "@/lib/format";
import { LogoutButton } from "./home-client";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  exact?: boolean;
};

const PRIMARY: NavItem[] = [
  { href: "/", label: "Início", icon: HomeIcon, exact: true },
  { href: "/hoje", label: "Hoje", icon: TodayIcon },
  { href: "/semestres", label: "Semestres", icon: SemesterIcon },
];
const SECONDARY: NavItem[] = [
  { href: "/compartilhar", label: "Compartilhar", icon: ShareIcon },
  { href: "/conta", label: "Conta", icon: UserIcon },
];

function useActive() {
  const pathname = usePathname();
  return (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Marca do app: o "P" em degradê, como o ícone de um espaço de trabalho. */
export function AppMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#2f7fd8] to-[#0b5aa8] font-bold text-white shadow-sm"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* "P" desenhado (não é texto: não entra no nome acessível dos links). */}
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        <path
          d="M8.5 19V5h4.75a4.25 4.25 0 0 1 0 8.5H8.5"
          stroke="currentColor"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export type SidebarSubject = { id: string; name: string; color: string | null };

/** Barra lateral do computador: espaço de trabalho, navegação e as matérias como "páginas". */
export function Sidebar({
  firstName,
  unread,
  semesterLabel,
  subjects,
}: {
  firstName: string;
  unread: number;
  semesterLabel: string | null;
  subjects: SidebarSubject[];
}) {
  const isActive = useActive();
  const item = (it: NavItem, extra?: ReactNode) => {
    const active = isActive(it.href, it.exact);
    const Icon = it.icon;
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
            active ? "bg-hover font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink"
          }`}
        >
          <Icon size={18} className="shrink-0" />
          <span className="flex-1 truncate">{it.label}</span>
          {extra}
        </Link>
      </li>
    );
  };

  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-r border-line bg-sidebar px-2.5 py-3 lg:flex">
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover"
      >
        <AppMark />
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-sm font-semibold">Presenças</span>
          <span className="truncate text-xs text-muted">de {firstName}</span>
        </span>
      </Link>

      <nav aria-label="Principal" className="grid gap-4">
        <ul className="grid gap-px">{PRIMARY.map((it) => item(it))}</ul>
        <ul className="grid gap-px">
          {item(
            { href: "/avisos", label: "Avisos", icon: BellIcon },
            unread > 0 ? (
              <span className="rounded-full bg-fail px-1.5 text-[11px] font-semibold leading-[18px] text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null,
          )}
          {SECONDARY.map((it) => item(it))}
        </ul>
      </nav>

      {semesterLabel ? (
        <section aria-labelledby="sidebar-materias" className="grid gap-1">
          {/* Rótulo do grupo, não um título: a página do semestre já tem o título com esse nome. */}
          <p
            id="sidebar-materias"
            className="truncate px-2 text-xs font-medium text-muted"
            title={`Matérias de ${semesterLabel}`}
          >
            {semesterLabel}
          </p>
          {subjects.length > 0 ? (
            <ul className="grid gap-px">
              {subjects.map((s) => {
                const active = isActive(`/materias/${s.id}`);
                return (
                  <li key={s.id}>
                    <Link
                      href={`/materias/${s.id}`}
                      aria-current={active ? "page" : undefined}
                      data-sidebar-subject
                      className={`flex min-h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
                        active
                          ? "bg-hover font-medium text-ink"
                          : "text-muted hover:bg-hover hover:text-ink"
                      }`}
                    >
                      <span
                        className={`size-2.5 shrink-0 rounded-[3px] ${s.color ? SUBJECT_COLOR_CLASS[s.color] : "bg-line-strong"}`}
                        aria-hidden
                      />
                      <span className="truncate">{s.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 text-xs text-muted">Nenhuma matéria ainda.</p>
          )}
        </section>
      ) : null}

      <div className="mt-auto px-1 [&_button]:w-full [&_button]:justify-start">
        <LogoutButton variant="ghost" />
      </div>
    </aside>
  );
}

/** Barra de abas do celular, presa embaixo (como um app). */
export function MobileTabBar() {
  const isActive = useActive();
  const tabs: NavItem[] = [...PRIMARY, { href: "/conta", label: "Conta", icon: UserIcon }];
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((t) => {
          const active = isActive(t.href, t.exact);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                <Icon size={22} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
