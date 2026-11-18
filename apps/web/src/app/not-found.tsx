import Link from "next/link";

/** 404, inclusive para semestre ou matéria de outra pessoa (a API não revela que existe). */
export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="text-2xl font-bold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço pode ter mudado, ou isto foi apagado.</p>
      <Link
        href="/"
        className="mx-auto inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
      >
        Ir para o início
      </Link>
    </main>
  );
}
