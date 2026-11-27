import Link from "next/link";
import { CompassIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 text-center">
      <div
        className="mx-auto grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-ink shadow-sm"
        aria-hidden
      >
        <CompassIcon size={30} />
      </div>
      <p className="text-sm font-medium text-muted">Erro 404</p>
      <h1 className="text-3xl font-bold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço pode ter mudado, ou isto foi apagado.</p>
      <Link
        href="/"
        className="mx-auto inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm hover:bg-accent/90"
      >
        Ir para o início
      </Link>
    </main>
  );
}
