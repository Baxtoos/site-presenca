"use client";

import {
  formatShareCode,
  type ImportTemplateResult,
  type TemplatePreview,
} from "@presenca/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, plural, SUBJECT_COLOR_CLASS, WEEKDAYS_SHORT } from "@/lib/format";
import { withNext } from "@/lib/next-path";

/**
 * Uma consulta por código por vez: o React (StrictMode) monta o efeito duas vezes, e cada busca
 * gasta o limite de consultas do visitante. A segunda montagem reaproveita a promessa em curso.
 */
const inFlight = new Map<string, Promise<TemplatePreview>>();
function fetchPreview(code: string): Promise<TemplatePreview> {
  let promise = inFlight.get(code);
  if (!promise) {
    promise = api<TemplatePreview>(`/v1/templates/${code}`).finally(() => inFlight.delete(code));
    inFlight.set(code, promise);
  }
  return promise;
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; preview: TemplatePreview }
  | { kind: "error"; message: string };

/**
 * Prévia buscada PELO NAVEGADOR (não pelo servidor do Next): o limite de consultas é por IP, e
 * vinda do servidor todo mundo pareceria o mesmo visitante.
 */
export function ImportPreview({
  code,
  loggedIn,
  semesters,
}: {
  code: string;
  loggedIn: boolean;
  semesters: { id: string; label: string; isCurrent: boolean }[];
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [target, setTarget] = useState(
    semesters.find((s) => s.isCurrent)?.id ?? semesters[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // Mesma chave em todas as tentativas desta tela: clique duplo ou rede instável não duplicam.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    fetchPreview(code)
      .then((preview) => !cancelled && setState({ kind: "ok", preview }))
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            e instanceof ApiError && e.problem.status === 404
              ? "Este código não existe mais: ele pode ter expirado, sido revogado ou atingido o limite de importações. Peça um novo a quem compartilhou."
              : e instanceof ApiError
                ? e.message
                : "Não foi possível carregar a grade.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function doImport(preview: TemplatePreview) {
    setPending(true);
    setError(undefined);
    try {
      const result = await api<ImportTemplateResult>(`/v1/templates/${code}/import`, {
        method: "POST",
        idempotencyKey,
        body: preview.kind === "subject" ? { semesterId: target } : {},
      });
      router.push(
        result.createdSemester
          ? `/semestres/${result.semesterId}`
          : `/materias/${result.subjectIds[0]}`,
      );
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (Object.values(e.fieldErrors)[0] ?? e.message)
          : "Não foi possível importar.",
      );
      setPending(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <section
        className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted"
        aria-busy
      >
        Carregando a grade {formatShareCode(code)}…
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6 text-sm">
        <h1 className="text-xl font-bold">Código {formatShareCode(code)}</h1>
        <Alert tone="error">{state.message}</Alert>
        <Link href="/importar" className="font-medium text-accent hover:underline">
          Digitar outro código
        </Link>
      </section>
    );
  }

  const p = state.preview;
  const next = `/importar/${code}`;
  return (
    <section
      className="grid gap-5 rounded-2xl border border-line bg-surface p-6"
      aria-labelledby="titulo-modelo"
    >
      <header className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">
          {p.kind === "semester" ? "Grade de semestre" : "Matéria"} · código{" "}
          {formatShareCode(p.code)}
        </p>
        <h1 id="titulo-modelo" className="text-2xl font-bold tracking-tight">
          {p.title}
        </h1>
        <p className="text-sm text-muted">
          {[p.institution, p.course].filter(Boolean).join(" · ")}
          {p.semester
            ? `${p.institution || p.course ? " · " : ""}${formatDate(p.semester.startsOn)} a ${formatDate(p.semester.endsOn)}`
            : ""}
        </p>
      </header>

      <ul className="grid gap-2" aria-label="Matérias">
        {p.subjects.map((s) => (
          <li
            key={s.name}
            className="relative grid gap-1 rounded-xl border border-line p-3 pl-4 text-sm"
            data-testid="materia-modelo"
          >
            <span
              className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl ${s.color ? SUBJECT_COLOR_CLASS[s.color] : "bg-line"}`}
              aria-hidden
            />
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>{s.name}</strong>
              <span className="text-xs text-muted">
                limite de {plural(s.maxAbsenceUnits, "falta", "faltas")}
              </span>
            </span>
            {s.professor ? <span className="text-xs text-muted">{s.professor}</span> : null}
            <span className="text-xs text-muted">
              {s.schedules.length === 0
                ? "sem horários na grade"
                : s.schedules
                    .map(
                      (x) =>
                        `${WEEKDAYS_SHORT[x.weekday]} ${x.startsAt}–${x.endsAt}${x.room ? ` (${x.room})` : ""}`,
                    )
                    .join(" · ")}
            </span>
          </li>
        ))}
      </ul>

      {p.exceptions.length > 0 ? (
        <p className="text-sm text-muted">
          Inclui{" "}
          {plural(p.exceptions.length, "feriado ou dia sem aula", "feriados e dias sem aula")}:{" "}
          {p.exceptions.map((e) => e.label).join(", ")}.
        </p>
      ) : null}

      <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        Você recebe uma cópia sua: pode editar à vontade, e nada do que você registrar aparece para
        quem compartilhou (nem o contrário).{" "}
        {p.usesCount > 0
          ? `${plural(p.usesCount, "pessoa já importou", "pessoas já importaram")}.`
          : ""}
      </p>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!loggedIn ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href={withNext("/cadastro", next)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
          >
            Criar conta e importar
          </Link>
          <Link
            href={withNext("/entrar", next)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
          >
            Já tenho conta
          </Link>
        </div>
      ) : p.kind === "subject" && semesters.length === 0 ? (
        <Alert tone="info">
          Para importar uma matéria, crie antes um semestre em{" "}
          <Link href="/semestres" className="font-medium underline">
            Semestres
          </Link>
          .
        </Alert>
      ) : (
        <div className="grid gap-3">
          {p.kind === "subject" ? (
            <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="semestre-destino">
              Em qual semestre ela entra
              <select
                id="semestre-destino"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base"
              >
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.isCurrent ? " (atual)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="button" loading={pending} onClick={() => void doImport(p)}>
            {p.kind === "semester" ? "Importar este semestre" : "Importar esta matéria"}
          </Button>
        </div>
      )}
    </section>
  );
}
