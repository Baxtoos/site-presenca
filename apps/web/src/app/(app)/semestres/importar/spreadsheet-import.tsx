"use client";

import type { SemesterImportBody, SemesterImportResult } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, plural, SUBJECT_COLOR_CLASS, WEEKDAYS_SHORT } from "@/lib/format";
import { readSpreadsheet } from "@/lib/spreadsheet-import";

/** A planilha do app tem poucas centenas de KB; isto barra arquivo errado antes de ler. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Ready = {
  fileName: string;
  source: "completa" | "abas";
  body: SemesterImportBody;
  warnings: string[];
};

type Subject = SemesterImportBody["subjects"][number];

function ruleText(s: Subject): string {
  if (s.countingMode === "workload") return `${s.workloadHours} h de carga`;
  if (s.countingMode === "class_count") return plural(s.totalClasses ?? 0, "aula", "aulas");
  return `limite manual de ${plural(s.manualMaxUnits ?? 0, "falta", "faltas")}`;
}

/**
 * O navegador lê a planilha (nada é enviado até o aluno confirmar), mostra o que vai ser criado e
 * manda tudo de uma vez para a API, que valida de novo e grava numa transação só.
 */
export function SpreadsheetImport() {
  const router = useRouter();
  const [reading, setReading] = useState(false);
  const [ready, setReady] = useState<Ready>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  // Uma chave por versão do que vai ser enviado: repetir após falha de rede não duplica, e editar
  // o nome ou as datas gera uma chave nova (a API recusaria a mesma chave com outro conteúdo).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setReady(undefined);
    setError(undefined);
    setFields({});
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("O arquivo é grande demais para ser uma planilha do app (máximo de 5 MB).");
      return;
    }
    setReading(true);
    try {
      const result = await readSpreadsheet(await file.arrayBuffer());
      if (result.ok) {
        setReady({
          fileName: file.name,
          source: result.source,
          body: result.body,
          warnings: result.warnings,
        });
        setIdempotencyKey(crypto.randomUUID());
      } else {
        setError(result.error);
      }
    } catch {
      setError("Não consegui ler o arquivo. Confira se é a planilha .xlsx exportada pelo app.");
    } finally {
      setReading(false);
    }
  }

  function editSemester(patch: Partial<SemesterImportBody["semester"]>) {
    if (!ready) return;
    setReady({ ...ready, body: { ...ready.body, semester: { ...ready.body.semester, ...patch } } });
    setIdempotencyKey(crypto.randomUUID());
  }

  async function doImport() {
    if (!ready) return;
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      const result = await api<SemesterImportResult>("/v1/imports/semester", {
        method: "POST",
        idempotencyKey,
        body: ready.body,
      });
      router.push(`/semestres/${result.semesterId}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        const byField = e.fieldErrors;
        setFields({
          label: byField["semester.label"] ?? "",
          startsOn: byField["semester.startsOn"] ?? "",
          endsOn: byField["semester.endsOn"] ?? "",
        });
        const others = Object.entries(byField).filter(([path]) => !path.startsWith("semester."));
        setError(others[0]?.[1] ?? (Object.keys(byField).length === 0 ? e.message : undefined));
      } else {
        setError("Não foi possível importar.");
      }
      setPending(false);
    }
  }

  const body = ready?.body;
  const counts = body
    ? {
        absences: body.attendance.filter((a) => a.status === "absent" || a.status === "partial")
          .length,
        presences: body.attendance.filter((a) => a.status === "present").length,
        cancelled: body.attendance.filter((a) => a.status === "cancelled").length,
      }
    : null;

  return (
    <div className="grid gap-5">
      <section className="card grid gap-3 p-5 sm:p-6" aria-labelledby="arquivo">
        <h2 id="arquivo" className="text-lg font-semibold">
          1. Escolha a planilha
        </h2>
        <p className="text-sm text-muted">
          Use o arquivo baixado em{" "}
          <strong>Semestres → (o semestre) → Exportar Excel (.xlsx)</strong>, neste app ou em outra
          conta. Ele é lido aqui no seu aparelho; nada é enviado até você confirmar.
        </p>
        <label
          htmlFor="planilha"
          className="grid min-h-24 cursor-pointer place-items-center rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-4 text-center text-sm transition-colors hover:bg-surface-2 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/20"
        >
          <span className="grid gap-1">
            <span className="font-medium">
              {reading
                ? "Lendo a planilha…"
                : ready
                  ? `${ready.fileName} · trocar arquivo`
                  : "Escolher arquivo .xlsx"}
            </span>
            <span className="text-xs text-muted">Planilha exportada pelo Monitor de Presenças</span>
          </span>
          <input
            id="planilha"
            name="planilha"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={reading || pending}
            onChange={(e) => void onFile(e)}
          />
        </label>
        {error && !ready ? <Alert tone="error">{error}</Alert> : null}
      </section>

      {ready && body && counts ? (
        <section className="card grid gap-5 p-5 sm:p-6" aria-labelledby="previa">
          <h2 id="previa" className="text-lg font-semibold">
            2. Confira o que vai ser criado
          </h2>

          {ready.source === "completa" ? (
            <Alert tone="success">
              Planilha completa: matérias, regras, grade, feriados, presenças e faltas entram
              exatamente como estavam.
            </Alert>
          ) : null}
          {ready.warnings.map((w) => (
            <Alert key={w} tone="info">
              {w}
            </Alert>
          ))}

          <div className="grid gap-4">
            <Field
              id="rotulo"
              label="Nome do semestre"
              value={body.semester.label}
              maxLength={60}
              required
              error={fields.label || undefined}
              hint="Se você já tiver um semestre com este nome, o novo ganha um número no fim."
              onChange={(e) => editSemester({ label: e.target.value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="inicio"
                label="Início das aulas"
                type="date"
                value={body.semester.startsOn}
                required
                error={fields.startsOn || undefined}
                onChange={(e) => editSemester({ startsOn: e.target.value })}
              />
              <Field
                id="fim"
                label="Fim das aulas"
                type="date"
                value={body.semester.endsOn}
                required
                error={fields.endsOn || undefined}
                onChange={(e) => editSemester({ endsOn: e.target.value })}
              />
            </div>
          </div>

          <p className="text-sm" data-testid="resumo-importacao">
            {plural(body.subjects.length, "matéria", "matérias")} ·{" "}
            {plural(counts.absences, "falta", "faltas")}
            {counts.presences > 0 ? ` · ${plural(counts.presences, "presença", "presenças")}` : ""}
            {counts.cancelled > 0
              ? ` · ${plural(counts.cancelled, "aula cancelada", "aulas canceladas")}`
              : ""}
            {body.exceptions.length > 0
              ? ` · ${plural(body.exceptions.length, "feriado ou dia sem aula", "feriados e dias sem aula")}`
              : ""}
          </p>

          <ul className="grid gap-2" aria-label="Matérias da planilha">
            {body.subjects.map((s, i) => {
              const absences = body.attendance.filter(
                (a) => a.subjectIndex === i && (a.status === "absent" || a.status === "partial"),
              ).length;
              return (
                <li
                  key={`${s.name}-${i}`}
                  className="relative grid gap-1 rounded-xl border border-line p-3 pl-4 text-sm"
                  data-testid="materia-planilha"
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl ${s.color ? SUBJECT_COLOR_CLASS[s.color] : "bg-line"}`}
                    aria-hidden
                  />
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong>{s.name}</strong>
                    <span className="text-xs text-muted">
                      {ruleText(s)} · {plural(absences, "falta", "faltas")}
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
              );
            })}
          </ul>

          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            Será criado um semestre novo de {formatDate(body.semester.startsOn)} a{" "}
            {formatDate(body.semester.endsOn)}. Os semestres que você já tem não mudam. Faltas
            antigas não geram avisos.
          </p>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <Button type="button" loading={pending} onClick={() => void doImport()}>
            Importar semestre
          </Button>
        </section>
      ) : null}
    </div>
  );
}
