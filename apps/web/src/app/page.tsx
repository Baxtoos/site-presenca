import { readinessResponseSchema, type ReadinessResponse } from "@presenca/contracts";

export const dynamic = "force-dynamic";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Lê o estado da API no servidor do Next. O web conhece só a API, nunca o banco. */
async function getApiStatus(): Promise<ReadinessResponse | null> {
  try {
    const res = await fetch(`${apiUrl}/readyz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    return readinessResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}

function Row({ label, up }: { label: string; up: boolean }) {
  return (
    <li className="flex items-center justify-between border-b border-line py-3 last:border-b-0">
      <span>{label}</span>
      <span className={`text-sm font-semibold ${up ? "text-ok" : "text-fail"}`}>
        {up ? "no ar" : "fora do ar"}
      </span>
    </li>
  );
}

export default async function Home() {
  const status = await getApiStatus();
  const database = status?.checks.database?.status === "up";

  return (
    <main className="mx-auto grid max-w-xl gap-6 px-4 py-16">
      <p className="font-mono text-xs tracking-widest text-muted uppercase">Fase 0 · fundação</p>
      <h1 className="text-3xl font-bold tracking-tight">Monitor de Presenças</h1>
      <p className="text-muted">
        Ambiente de desenvolvimento no ar. As telas de login, grade e registro de faltas chegam nas
        próximas fases.
      </p>
      <ul className="rounded-lg border border-line px-4">
        <Row label="Web (Next.js)" up />
        <Row label="API" up={status !== null} />
        <Row label="Banco (visto pela API)" up={database} />
      </ul>
    </main>
  );
}
