import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { SubjectPreviewCard } from "@/components/app-preview";
import {
  BellIcon,
  CalendarIcon,
  ChevronRightIcon,
  ShareIcon,
  UsersIcon,
  WifiOffIcon,
} from "@/components/icons";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "Monitor de Presenças · Saiba quanto você ainda pode faltar",
  description:
    "Cadastre a regra de faltas de cada matéria, marque presença com um toque e receba aviso antes de chegar ao limite. Grátis, funciona no celular e até sem internet.",
};

type Feature = { icon: ComponentType<{ size?: number }>; title: string; text: string };

const FEATURES: Feature[] = [
  {
    icon: CalendarIcon,
    title: "Calendário por matéria",
    text: "Cada matéria tem o seu calendário com as aulas da grade. Um toque marca presença ou falta, e dá para corrigir depois.",
  },
  {
    icon: BellIcon,
    title: "Aviso antes do limite",
    text: "Receba aviso por e-mail e no celular quando passar de 50%, 75% e 90% das faltas permitidas, do jeito que você configurar.",
  },
  {
    icon: WifiOffIcon,
    title: "Funciona sem internet",
    text: "Instale no celular como um app. Sem sinal na sala, a marcação fica guardada e vai sozinha quando a conexão volta.",
  },
  {
    icon: UsersIcon,
    title: "A grade da turma por um código",
    text: "Monte o semestre uma vez e compartilhe um código ou QR Code. Os colegas importam matérias, horários e regras em segundos.",
  },
];

const STEPS = [
  {
    title: "Monte o semestre",
    text: "Datas das aulas, feriados e as matérias com horários e a regra de faltas (porcentagem ou número fixo).",
  },
  {
    title: "Marque cada aula",
    text: "Na tela Hoje ou no calendário da matéria: presença, falta ou aula cancelada.",
  },
  {
    title: "Saiba o que ainda pode",
    text: "O app faz a conta e mostra quantas aulas você ainda pode faltar, matéria por matéria.",
  },
];

/**
 * Apresentação pública do app. O site mostra esta página em "/" para quem não está logado
 * (ver src/proxy.ts); quem está logado vê o Início.
 */
export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-6">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2">
          <span className="text-base font-semibold tracking-tight">Monitor de Presenças</span>
          <span className="flex-1" />
          <ButtonLink href="/entrar" variant="ghost">
            Entrar
          </ButtonLink>
          <ButtonLink href="/cadastro">Criar conta</ButtonLink>
        </div>
      </header>

      <main>
        <section className="px-4 pb-16 pt-12 sm:px-6 lg:pb-24 lg:pt-20">
          <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
            <div className="grid gap-6">
              <p className="w-fit rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Grátis para estudantes
              </p>
              <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
                Saiba quanto você ainda pode faltar.
              </h1>
              <p className="max-w-xl text-lg text-muted">
                Cadastre a regra de faltas de cada matéria uma vez. O Monitor de Presenças faz a
                conta, avisa antes de você chegar ao limite e funciona até sem internet.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <ButtonLink href="/cadastro" className="px-5">
                  Criar conta grátis
                </ButtonLink>
                <ButtonLink href="/entrar" variant="secondary" className="px-5">
                  Já tenho conta
                </ButtonLink>
              </div>
              <Link
                href="/importar"
                className="group flex w-fit items-center gap-2 text-sm font-medium text-accent hover:underline"
              >
                <ShareIcon size={16} />
                Recebeu um código da turma? Importar a grade
                <ChevronRightIcon
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>

            <div className="relative mx-auto grid w-full max-w-sm gap-3" aria-hidden>
              <SubjectPreviewCard className="shadow-pop" />
              <div className="card flex items-start gap-3 p-4 text-sm shadow-sm sm:ml-10">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-warn-soft text-warn">
                  <BellIcon size={17} />
                </span>
                <div className="grid gap-0.5">
                  <p className="font-semibold">Física II: 75% do limite de faltas</p>
                  <p className="text-muted">Ainda pode faltar 4 tempos (cerca de 2 aulas).</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="recursos"
          className="border-y border-line bg-sidebar px-4 py-16 sm:px-6 lg:py-20"
        >
          <div className="mx-auto grid max-w-5xl gap-10">
            <div className="grid max-w-2xl gap-2">
              <h2 id="recursos" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Feito para a rotina da faculdade
              </h2>
              <p className="text-muted">
                Nada de planilha ou anotação no caderno: o controle fica no bolso.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <li key={f.title} className="card grid content-start gap-3 p-5 sm:p-6">
                    <span
                      className="grid size-10 place-items-center rounded-lg border border-line bg-surface-2 text-ink"
                      aria-hidden
                    >
                      <Icon size={20} />
                    </span>
                    <h3 className="text-base font-semibold">{f.title}</h3>
                    <p className="text-sm text-muted">{f.text}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section aria-labelledby="como-funciona" className="px-4 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto grid max-w-5xl gap-10">
            <h2 id="como-funciona" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Como funciona
            </h2>
            <ol className="grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="grid content-start gap-2">
                  <span
                    className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="comece" className="px-4 pb-16 sm:px-6 lg:pb-24">
          <div className="card mx-auto grid max-w-5xl gap-5 bg-sidebar p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-2">
              <h2 id="comece" className="text-2xl font-bold tracking-tight">
                Comece pelo seu semestre
              </h2>
              <p className="max-w-xl text-muted">
                Leva menos de um minuto para criar a conta. Seus dados são seus: dá para baixar uma
                cópia ou excluir a conta quando quiser.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/cadastro" className="px-5">
                Criar conta grátis
              </ButtonLink>
              <ButtonLink href="/entrar" variant="secondary" className="px-5">
                Entrar
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <span>Monitor de Presenças</span>
          <span className="flex-1" />
          <Link href="/termos" className="hover:text-ink hover:underline">
            Termos de Uso
          </Link>
          <Link href="/privacidade" className="hover:text-ink hover:underline">
            Privacidade e LGPD
          </Link>
        </div>
      </footer>
    </div>
  );
}
