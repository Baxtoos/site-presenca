"use client";

import type { SemesterImportBody } from "@presenca/contracts";
import { type ChangeEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { formatDate, plural, SUBJECT_COLOR_CLASS, WEEKDAYS_SHORT } from "@/lib/format";
import { readTables, type Table } from "@/lib/own-spreadsheet";
import { readSpreadsheet } from "@/lib/spreadsheet-import";
import { OwnSpreadsheetImport } from "./own-spreadsheet-import";
import { useImportSubmit } from "./use-import-submit";

/** Planilhas de presença têm poucas centenas de KB; isto barra arquivo errado antes de ler. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Ready = {
  fileName: string;
  source: "completa" | "abas";
  body: SemesterImportBody;
  warnings: string[];
};

type Own = { fileName: string; tables: Table[]; id: number };

type Subject = SemesterImportBody["subjects"][number];

function ruleText(s: Subject): string {
  if (s.countingMode === "workload") return `${s.workloadHours} h de carga`;
  if (s.countingMode === "class_count") return plural(s.totalClasses ?? 0, "aula", "aulas");
  return `limite manual de ${plural(s.manualMaxUnits ?? 0, "falta", "faltas")}`;
}

/** Planilha modelo para quem quer passar os registros a limpo antes de importar. */
async function downloadTemplate() {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const sheet = wb.addWorksheet("Presenças");
  sheet.columns = [
    { header: "Data", key: "data", width: 12 },
    { header: "Matéria", key: "materia", width: 28 },
    { header: "Situação", key: "situacao", width: 14 },
    { header: "Tempos", key: "tempos", width: 9 },
    { header: "Motivo", key: "motivo", width: 18 },
    { header: "Observação", key: "obs", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  const help = wb.addWorksheet("Como preencher");
  help.getColumn(1).width = 100;
  [
    "Uma linha por aula na aba Presenças. Só a Data é obrigatória.",
    "Data: dd/mm/aaaa (ex.: 02/03/2026).",
    "Matéria: o nome da matéria (igual em todas as linhas dela).",
    "Situação: P (presença), F (falta), Atestado ou Cancelada. Em branco = falta.",
    "Tempos: quantos tempos você faltou, se foi só parte da aula (ex.: 1 de 2). Pode deixar em branco.",
    "Motivo e Observação: opcionais; vão para as anotações da aula.",
    "Depois, em Semestres → Importar planilha, escolha este arquivo.",
  ].forEach((line) => help.addRow([line]));
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-presencas.xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * O navegador lê a planilha (nada é enviado até o aluno confirmar), mostra o que vai ser criado e
 * manda tudo de uma vez para a API, que valida de novo e grava numa transação só. Planilha
 * exportada pelo app entra direto; qualquer outra vai para a leitura guiada (OwnSpreadsheetImport).
 */
export function SpreadsheetImport() {
  const [reading, setReading] = useState(false);
  const [ready, setReady] = useState<Ready>();
  const [own, setOwn] = useState<Own>();
  const [readError, setReadError] = useState<string>();
  const { pending, error, fields, submit } = useImportSubmit();

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setReady(undefined);
    setOwn(undefined);
    setReadError(undefined);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setReadError("O arquivo é grande demais (máximo de 5 MB).");
      return;
    }
    setReading(true);
    try {
      const buffer = await file.arrayBuffer();
      const isCsv = /\.(csv|txt)$/i.test(file.name);
      const result = isCsv ? null : await readSpreadsheet(buffer);
      if (result?.ok) {
        setReady({
          fileName: file.name,
          source: result.source,
          body: result.body,
          warnings: result.warnings,
        });
      } else if (!result || result.foreign) {
        setOwn({
          fileName: file.name,
          tables: await readTables(buffer, file.name),
          id: Date.now(),
        });
      } else {
        setReadError(result.error);
      }
    } catch {
      setReadError("Não consegui ler o arquivo. Ele precisa ser uma planilha .xlsx ou .csv.");
    } finally {
      setReading(false);
    }
  }

  function editSemester(patch: Partial<SemesterImportBody["semester"]>) {
    if (!ready) return;
    setReady({ ...ready, body: { ...ready.body, semester: { ...ready.body.semester, ...patch } } });
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
          Pode ser a planilha exportada pelo app (em{" "}
          <strong>Semestres → (o semestre) → Exportar Excel</strong>) ou a planilha que você mesmo
          fazia, em .xlsx ou .csv (do Google Planilhas: Arquivo → Fazer download). Ela é lida aqui
          no seu aparelho; nada é enviado até você confirmar.
        </p>
        <label
          htmlFor="planilha"
          className="grid min-h-24 cursor-pointer place-items-center rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-4 text-center text-sm transition-colors hover:bg-surface-2 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/20"
        >
          <span className="grid gap-1">
            <span className="font-medium">
              {reading
                ? "Lendo a planilha…"
                : (ready ?? own)
                  ? `${(ready ?? own)!.fileName} · trocar arquivo`
                  : "Escolher arquivo .xlsx ou .csv"}
            </span>
            <span className="text-xs text-muted">Planilha do app ou sua própria planilha</span>
          </span>
          <input
            id="planilha"
            name="planilha"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            disabled={reading || pending}
            onChange={(e) => void onFile(e)}
          />
        </label>
        {readError ? <Alert tone="error">{readError}</Alert> : null}
        <p className="text-xs text-muted">
          Sua planilha está bagunçada?{" "}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => void downloadTemplate()}
          >
            Baixe a planilha modelo
          </button>
          , copie seus registros para ela e importe.
        </p>
      </section>

      {own ? (
        <OwnSpreadsheetImport key={own.id} fileName={own.fileName} tables={own.tables} />
      ) : null}

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

          <Button type="button" loading={pending} onClick={() => void submit(ready.body)}>
            Importar semestre
          </Button>
        </section>
      ) : null}
    </div>
  );
}
