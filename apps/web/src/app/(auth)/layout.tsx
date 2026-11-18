import Link from "next/link";
import type { ReactNode } from "react";

/** Moldura das telas de entrada: coluna estreita, marca no topo, sem distrações. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-start gap-8 px-4 pb-16 pt-[max(3rem,env(safe-area-inset-top))]">
      <Link href="/" className="flex items-center gap-2 self-start text-sm font-semibold text-ink">
        <span
          className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-accent-ink"
          aria-hidden
        >
          P
        </span>
        Monitor de Presenças
      </Link>
      <section className="grid gap-6 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        {children}
      </section>
      <footer className="flex flex-wrap justify-center gap-4 text-xs text-muted">
        <Link href="/termos" className="hover:text-ink hover:underline">
          Termos de Uso
        </Link>
        <span aria-hidden>·</span>
        <Link href="/privacidade" className="hover:text-ink hover:underline">
          Privacidade e LGPD
        </Link>
      </footer>
    </main>
  );
}
