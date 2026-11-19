import type { Metadata } from "next";
import { WifiOffIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Sem conexão · Monitor de Presenças" };

/**
 * Mostrada pelo service worker quando não há internet e a página pedida nunca foi aberta neste
 * aparelho. É estática (sem dados de ninguém) para poder ficar guardada no cache.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-6 text-center">
      <span
        className="mx-auto grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-ink shadow-sm"
        aria-hidden
      >
        <WifiOffIcon size={30} />
      </span>
      <h1 className="text-3xl font-bold tracking-tight">Sem conexão</h1>
      <p className="text-muted">
        Esta página ainda não foi aberta neste aparelho, então não há uma cópia para mostrar
        offline. As páginas que você já visitou (como as aulas de hoje) abrem sem internet.
      </p>
      {/* <a> de propósito: recarrega a página inteira, passando de novo pelo service worker. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mx-auto inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm hover:bg-accent/90"
      >
        Tentar de novo
      </a>
    </main>
  );
}
