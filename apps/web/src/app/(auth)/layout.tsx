import Link from "next/link";
import type { ReactNode } from "react";
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
          className="-ml-1.5 flex w-fit items-center gap-2.5 rounded-md px-1.5 py-1 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
        >
          <span
            className="grid size-8 place-items-center rounded-md bg-gradient-to-br from-[#2f7fd8] to-[#0b5aa8] text-base font-bold text-white shadow-sm"
            aria-hidden
          >
            P
          </span>
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

          {/* Prévia ilustrativa de um card de matéria. */}
          <div className="card relative grid gap-3 overflow-hidden p-4 pt-5 shadow-sm" aria-hidden>
            <span className="absolute inset-x-0 top-0 h-1.5 bg-[#3b82c4]" />
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <p className="font-semibold">Cálculo I</p>
                <p className="text-xs text-muted">Seg · Qua</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
                <span className="size-1.5 rounded-full bg-current" />
                Seguro
              </span>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span>
                  <strong className="text-xl font-semibold">4</strong>
                  <span className="text-muted"> de 18 faltas</span>
                </span>
                <span className="text-xs text-muted">22% do limite</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full w-[22%] rounded-full bg-ok" />
              </div>
            </div>
            <p className="text-sm">
              Ainda pode faltar <strong>14 tempos</strong>
              <span className="text-muted"> (7 encontros)</span>.
            </p>
          </div>

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
