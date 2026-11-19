import Link from "next/link";
import type { ReactNode } from "react";
import { SubjectPreviewCard } from "@/components/app-preview";
import { BellIcon, BookIcon, TodayIcon, UsersIcon } from "@/components/icons";

/**
 * Telas de entrada: formulário limpo à esquerda e, no computador, uma apresentação do app à
 * direita (o que ele faz, com uma prévia do card de matéria).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="mx-auto grid w-full max-w-[26rem] content-start gap-8 px-5 pb-16 pt-[max(2.5rem,env(safe-area-inset-top))] lg:content-center lg:pt-10">
        <Link
          href="/"
          className="-ml-1.5 flex w-fit items-center rounded-md px-1.5 py-1 text-base font-semibold tracking-tight text-ink transition-colors hover:bg-surface-2"
        >
          Monitor de Presenças
        </Link>
        <section className="grid gap-6">{children}</section>
        <footer className="flex flex-wrap gap-4 text-xs text-muted">
          <Link href="/termos" className="hover:text-ink hover:underline">
            Termos de Uso
          </Link>
          <span aria-hidden>·</span>
          <Link href="/privacidade" className="hover:text-ink hover:underline">
            Privacidade e LGPD
          </Link>
        </footer>
      </main>

      <aside
        className="relative hidden overflow-hidden border-l border-line bg-sidebar lg:grid lg:content-center"
        aria-label="Sobre o Monitor de Presenças"
      >
        <div className="mx-auto grid w-full max-w-md gap-8 px-10">
          <div className="grid gap-3">
            <div
              className="grid size-12 place-items-center rounded-xl border border-line bg-surface text-ink shadow-sm"
              aria-hidden
            >
              <BookIcon size={26} />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-balance">
              Saiba quanto você ainda pode faltar.
            </h2>
            <p className="text-[15px] text-muted">
              Cadastre a regra de faltas de cada matéria uma vez. O app faz a conta, avisa antes de
              você chegar ao limite e funciona até sem internet.
            </p>
          </div>

          <SubjectPreviewCard />

          <ul className="grid gap-2.5 text-sm">
            {(
              [
                [TodayIcon, "Calendário para marcar presença e falta com um toque"],
                [BellIcon, "Aviso por e-mail e no celular perto do limite"],
                [UsersIcon, "Compartilhe a grade com a turma por um código"],
              ] as const
            ).map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted shadow-sm"
                  aria-hidden
                >
                  <Icon size={17} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
