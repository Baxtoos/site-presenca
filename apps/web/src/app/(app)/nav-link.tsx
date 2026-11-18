"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-lg px-2.5 py-2 font-medium sm:px-3 transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}
