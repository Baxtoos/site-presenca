import Link from "next/link";
import type { ReactNode } from "react";

/** Importar grade: aberto também para quem ainda não tem conta (o link circula entre colegas). */
export default function ImportLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <Link href="/" className="flex items-center gap-2 self-start text-sm font-semibold text-ink">
        <span
          className="grid size-8 place-items-center rounded-md bg-gradient-to-br from-[#2f7fd8] to-[#0b5aa8] font-bold text-white shadow-sm"
          aria-hidden
        >
          P
        </span>
        Monitor de Presenças
      </Link>
      {children}
    </main>
  );
}
