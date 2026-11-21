"use client";

import { type SuapSnapshot, suapSnapshotSchema, type SuapSyncResult } from "@presenca/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { plural } from "@/lib/format";

/** Onde o script da página (lib/url-mask.ts) guarda o retrato que veio no #suap=... */
const STORAGE_KEY = "presenca:suap";

function readPending(): SuapSnapshot | "invalid" | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = suapSnapshotSchema.safeParse(JSON.parse(decodeURIComponent(raw)));
    return parsed.success ? parsed.data : "invalid";
  } catch {
    return "invalid";
  }
}

const clearPending = () => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sem armazenamento: nada a limpar
  }
};

/** Hoje no fuso do aparelho, em AAAA-MM-DD. */
const localToday = () => new Date().toLocaleDateString("en-CA");

/**
 * Confirmação do que o favorito trouxe do SUAP: mostra as matérias e as faltas e deixa escolher
 * entre criar um semestre novo ou atualizar um que já existe (o SUAP vale para as aulas lançadas).
 */
export function SuapImport({
  semesters,
}: {
  semesters: { id: string; label: string; isCurrent: boolean }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<SuapSnapshot | "invalid" | null>(null);
  const [target, setTarget] = useState<string>("new");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const key = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    const found = readPending();
    if (!found) return;
    // Lido uma vez ao abrir a tela (sessionStorage só existe no navegador).
    setSnapshot(found);
    if (found !== "invalid") {
      const label = found.period.replace("_", ".");
      const match = semesters.find((s) => s.label === label);
      setTarget(match?.id ?? "new");
    }
  }, [semesters]);

  if (!snapshot) return null;
  if (snapshot === "invalid") {
    return (
      <section className="card grid gap-3 p-5 sm:p-6">
        <Alert tone="error">
          Os dados que vieram do SUAP estão incompletos. Abra o boletim no SUAP e clique no favorito
          de novo.
        </Alert>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            clearPending();
            setSnapshot(null);
          }}
        >
          Fechar
        </Button>
      </section>
    );
  }

  const today = localToday();
  const lessons = snapshot.subjects.flatMap((s) => s.lessons);
  const done = lessons.filter((l) => l.date <= today);
  const future = lessons.length - done.length;
  const missing = snapshot.subjects.filter((s) => s.lessons.length === 0);

  async function submit(data: SuapSnapshot) {
    setPending(true);
    setError(undefined);
    try {
      const result = await api<SuapSyncResult>("/v1/imports/suap", {
        method: "POST",
        idempotencyKey: key.current,
        body: { semesterId: target === "new" ? null : target, snapshot: data },
      });
      clearPending();
      toast.push({
        tone: "success",
        message: result.createdSemester
          ? `Semestre ${result.label} criado com ${plural(result.created, "aula", "aulas")} do SUAP.`
          : `SUAP em dia: ${plural(result.created, "aula nova", "aulas novas")}, ${plural(result.updated, "corrigida", "corrigidas")}.`,
      });
      router.push(`/semestres/${result.semesterId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível importar do SUAP.");
      setPending(false);
    }
  }

  return (
    <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="suap-titulo">
      <header className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">
          Do SUAP · {snapshot.host}
        </p>
        <h2 id="suap-titulo" className="text-xl font-semibold">
          Período {snapshot.period.replace("_", "/")}
        </h2>
        <p className="text-sm text-muted" data-testid="suap-resumo">
          {plural(snapshot.subjects.length, "disciplina", "disciplinas")} ·{" "}
          {plural(done.length, "aula lançada", "aulas lançadas")}
          {future > 0 ? ` · ${plural(future, "aula futura", "aulas futuras")}` : ""}
        </p>
      </header>

      <ul className="grid gap-2">
        {snapshot.subjects.map((s) => {
          const missed = s.lessons.reduce((sum, l) => sum + (l.date <= today ? l.absences : 0), 0);
          return (
            <li
              key={s.diario}
              className="grid gap-0.5 rounded-xl border border-line p-3 text-sm"
              data-testid="suap-disciplina"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{s.name}</strong>
                <span className="text-xs text-muted">{s.code}</span>
              </span>
              <span className="text-xs text-muted">
                {plural(missed, "falta", "faltas")}
                {s.plannedUnits ? ` de ${s.plannedUnits} aulas previstas` : ""}
                {s.frequencyPct !== null
                  ? ` · ${String(s.frequencyPct).replace(".", ",")}% de frequência no SUAP`
                  : ""}
                {s.slots.length === 0 ? " · sem horário no SUAP" : ""}
              </span>
            </li>
          );
        })}
      </ul>

      {missing.length > 0 ? (
        <Alert tone="info">
          Não encontrei aulas lançadas em {missing.map((s) => s.name).join(", ")}. Elas entram sem
          registros; clique no favorito de novo quando o professor lançar.
        </Alert>
      ) : null}

      <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="suap-destino">
        Onde colocar
        <select
          id="suap-destino"
          className={INPUT_CLASS}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="new">Criar um semestre novo</option>
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              Atualizar {s.label}
              {s.isCurrent ? " (atual)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        {target === "new"
          ? "Cria o semestre com as disciplinas, o horário, a regra de 75% e as aulas já lançadas. Faltas antigas não geram avisos."
          : "Nas aulas que o professor já lançou, vale o SUAP. O que você marcou em outros dias continua como está. Disciplinas que faltarem são criadas."}{" "}
        A sua senha do SUAP nunca passa pelo Monitor.
      </p>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending} onClick={() => void submit(snapshot)}>
          {target === "new" ? "Criar semestre" : "Atualizar semestre"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            clearPending();
            setSnapshot(null);
          }}
        >
          Descartar
        </Button>
      </div>
      <p className="text-xs text-muted">
        Ainda não tem o favorito?{" "}
        <Link href="/semestres/suap" className="font-medium text-accent hover:underline">
          Veja como conectar o SUAP
        </Link>
        .
      </p>
    </section>
  );
}
