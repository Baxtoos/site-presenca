"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Field, INPUT_CLASS } from "@/components/ui";
import { formatDate, plural, WEEKDAYS_SHORT } from "@/lib/format";
import {
  buildImport,
  type Choice,
  defaultSemester,
  defaultSubjects,
  detectLayout,
  extractRecords,
  guessChoice,
  type Layout,
  type ListColumns,
  NO_STATUS,
  type SubjectConfig,
  type Table,
  tokensOf,
} from "@/lib/own-spreadsheet";
import { useImportSubmit } from "./use-import-submit";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "present", label: "Presença" },
  { value: "absent", label: "Falta" },
  { value: "excused", label: "Falta com atestado" },
  { value: "cancelled", label: "Aula cancelada" },
  { value: "ignore", label: "Não importar" },
];

const COLUMN_FIELDS: { key: keyof ListColumns; label: string; required?: boolean }[] = [
  { key: "date", label: "Data", required: true },
  { key: "subject", label: "Matéria" },
  { key: "status", label: "Situação (P, F...)" },
  { key: "units", label: "Aulas" },
  { key: "reason", label: "Motivo" },
  { key: "note", label: "Observação" },
];

const MODES: { value: SubjectConfig["countingMode"]; label: string; amount: string }[] = [
  { value: "workload", label: "Carga horária", amount: "Horas" },
  { value: "class_count", label: "Número de aulas", amount: "Aulas" },
  { value: "manual", label: "Limite de faltas", amount: "Faltas permitidas" },
];

const columnName = (i: number) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const localToday = () => new Date().toLocaleDateString("en-CA");

export function OwnSpreadsheetImport({ fileName, tables }: { fileName: string; tables: Table[] }) {
  const [today] = useState(localToday);
  const [layouts, setLayouts] = useState<Layout[]>(() => tables.map((t) => detectLayout(t, today)));
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  const [userChoices, setUserChoices] = useState<Record<string, Choice>>({});
  const [subjectEdits, setSubjectEdits] = useState<Record<string, Partial<SubjectConfig>>>({});
  const [semesterEdits, setSemesterEdits] = useState<
    Partial<{ label: string; startsOn: string; endsOn: string }>
  >({});
  const { pending, error, fields, submit } = useImportSubmit();

  const perTable = useMemo(
    () => tables.map((t, i) => extractRecords(t, layouts[i]!, today)),
    [tables, layouts, today],
  );
  const records = useMemo(
    () => perTable.flatMap((r, i) => (skipped[i] ? [] : r)),
    [perTable, skipped],
  );
  const tokens = useMemo(() => tokensOf(records), [records]);
  const choices = useMemo(
    () =>
      Object.fromEntries(
        tokens.map((t) => [t.token, userChoices[t.token] ?? guessChoice(t.token).choice]),
      ) as Record<string, Choice | null>,
    [tokens, userChoices],
  );
  const subjects = useMemo(
    () => defaultSubjects(records, choices, today).map((s) => ({ ...s, ...subjectEdits[s.key] })),
    [records, choices, today, subjectEdits],
  );
  const semester = { ...defaultSemester(records, today), ...semesterEdits };
  const built = buildImport({ records, choices, subjects, semester, today });

  const editSubject = (key: string, patch: Partial<SubjectConfig>) =>
    setSubjectEdits((all) => ({ ...all, [key]: { ...all[key], ...patch } }));

  const setColumn = (tableIndex: number, key: keyof ListColumns, value: number | null) =>
    setLayouts((all) =>
      all.map((l, i) =>
        i === tableIndex && l.kind === "list"
          ? { ...l, columns: { ...l.columns, [key]: value ?? (key === "date" ? 0 : null) } }
          : l,
      ),
    );

  const recognized = layouts.some((l) => l.kind !== "none");

  return (
    <>
      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="organizacao">
        <h2 id="organizacao" className="text-lg font-semibold">
          2. Como a planilha está organizada
        </h2>
        <p className="text-sm text-muted">
          {fileName} não foi exportada pelo app, então li como uma planilha sua. Confira se entendi
          certo cada aba.
        </p>
        {!recognized ? (
          <Alert tone="error">
            Não encontrei datas de aula em nenhuma aba. A planilha precisa ter uma data por aula:
            numa coluna (uma linha por aula) ou numa linha (uma coluna por data). Se preferir, baixe
            a planilha modelo acima e copie seus registros para ela.
          </Alert>
        ) : null}
        <ul className="grid gap-3">
          {tables.map((table, ti) => {
            const layout = layouts[ti]!;
            const count = perTable[ti]!.length;
            if (layout.kind === "none") {
              return (
                <li key={ti} className="text-sm text-muted">
                  Aba “{table.name}”: sem datas de aula, fica de fora.
                </li>
              );
            }
            const headerRow = layout.header >= 0 ? (table.rows[layout.header] ?? []) : [];
            const width = Math.max(1, ...table.rows.slice(0, 50).map((r) => r.length));
            return (
              <li key={ti} className="grid gap-3 rounded-xl border border-line p-3 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-accent"
                    checked={!skipped[ti]}
                    onChange={(e) => setSkipped((s) => ({ ...s, [ti]: !e.target.checked }))}
                  />
                  <span className="grid gap-0.5">
                    <strong>Aba “{table.name}”</strong>
                    <span className="text-muted" data-testid="formato-aba">
                      {layout.kind === "list"
                        ? "Uma linha por aula"
                        : layout.kind === "dates-across"
                          ? `Uma linha por matéria e uma coluna por data (${plural(layout.dates.length, "data", "datas")})`
                          : `Uma linha por data e uma coluna por matéria (${plural(layout.subjects.length, "matéria", "matérias")})`}
                      {" · "}
                      {plural(count, "registro", "registros")}
                    </span>
                  </span>
                </label>
                {layout.kind === "list" && !skipped[ti] ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {COLUMN_FIELDS.map((f) => (
                      <label key={f.key} className="grid min-w-0 gap-1 text-xs font-medium">
                        {f.label}
                        <select
                          className={INPUT_CLASS}
                          value={layout.columns[f.key] ?? ""}
                          onChange={(e) =>
                            setColumn(
                              ti,
                              f.key,
                              e.target.value === "" ? null : Number(e.target.value),
                            )
                          }
                        >
                          {f.required ? null : (
                            <option value="">
                              {f.key === "subject"
                                ? `Não tem (matéria: ${table.name})`
                                : f.key === "status"
                                  ? "Não tem (cada linha é uma falta)"
                                  : "Não tem"}
                            </option>
                          )}
                          {Array.from({ length: width }, (_, c) => {
                            const name = headerRow[c];
                            return (
                              <option key={c} value={c}>
                                Coluna {columnName(c)}
                                {name && !(name instanceof Date) ? ` · ${String(name)}` : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {records.length > 0 ? (
        <>
          <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="marcacoes">
            <h2 id="marcacoes" className="text-lg font-semibold">
              3. O que cada marcação significa
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {tokens.map((t) => {
                const choice = choices[t.token];
                const units = guessChoice(t.token).units;
                const id = `marcacao-${t.token}`;
                return (
                  <li key={t.token} className="grid gap-1 text-sm">
                    <label htmlFor={id} className="font-medium">
                      {t.token === NO_STATUS ? t.label : `“${t.label}”`}{" "}
                      <span className="font-normal text-muted">
                        · {plural(t.count, "vez", "vezes")}
                        {units && (choice === "absent" || choice === "excused")
                          ? ` · ${plural(units, "aula", "aulas")}`
                          : ""}
                      </span>
                    </label>
                    <select
                      id={id}
                      className={`${INPUT_CLASS} ${choice === null ? "border-fail" : ""}`}
                      value={choice ?? ""}
                      aria-invalid={choice === null ? true : undefined}
                      onChange={(e) =>
                        setUserChoices((c) => ({ ...c, [t.token]: e.target.value as Choice }))
                      }
                    >
                      {choice === null ? <option value="">Escolha…</option> : null}
                      {CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="materias-planilha">
            <h2 id="materias-planilha" className="text-lg font-semibold">
              4. Regras e horários das matérias
            </h2>
            <p className="text-sm text-muted">
              A planilha não diz o limite de faltas nem o horário: confira. Os dias marcados são os
              que aparecem nos seus registros; aula em outro dia entra como aula avulsa. Tudo pode
              ser mudado depois na matéria.
            </p>
            <ul className="grid gap-3">
              {subjects.map((s, si) => {
                const mode = MODES.find((m) => m.value === s.countingMode)!;
                const id = `materia-${si}`;
                return (
                  <li
                    key={s.key}
                    className="grid gap-3 rounded-xl border border-line p-3 text-sm"
                    data-testid="materia-propria"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Importar ${s.name}`}
                        className="size-4 accent-accent"
                        checked={s.include}
                        onChange={(e) => editSubject(s.key, { include: e.target.checked })}
                      />
                      <div className="min-w-0 flex-1">
                        <Field
                          id={`${id}-nome`}
                          label="Matéria"
                          value={s.name}
                          maxLength={120}
                          disabled={!s.include}
                          onChange={(e) => editSubject(s.key, { name: e.target.value })}
                        />
                      </div>
                    </div>
                    {s.include ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                            Como contar
                            <select
                              className={INPUT_CLASS}
                              value={s.countingMode}
                              onChange={(e) =>
                                editSubject(s.key, {
                                  countingMode: e.target.value as SubjectConfig["countingMode"],
                                  amount:
                                    e.target.value === "workload"
                                      ? 60
                                      : e.target.value === "class_count"
                                        ? 36
                                        : 8,
                                })
                              }
                            >
                              {MODES.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Field
                            id={`${id}-quantidade`}
                            label={mode.amount}
                            type="number"
                            min={0}
                            step={s.countingMode === "workload" ? "0.5" : "1"}
                            value={String(s.amount)}
                            onChange={(e) => editSubject(s.key, { amount: Number(e.target.value) })}
                          />
                          {s.countingMode === "manual" ? null : (
                            <Field
                              id={`${id}-minimo`}
                              label="Presença mínima (%)"
                              type="number"
                              min={0}
                              max={100}
                              value={String(s.minPercent)}
                              onChange={(e) =>
                                editSubject(s.key, { minPercent: Number(e.target.value) })
                              }
                            />
                          )}
                          <Field
                            id={`${id}-tempos`}
                            label="Aulas por dia"
                            type="number"
                            min={1}
                            max={6}
                            value={String(s.unitsPerClass)}
                            onChange={(e) =>
                              editSubject(s.key, {
                                unitsPerClass: Math.min(
                                  6,
                                  Math.max(1, Number(e.target.value) || 1),
                                ),
                              })
                            }
                          />
                        </div>
                        <fieldset className="grid gap-2">
                          <legend className="mb-1.5 text-sm font-medium">Dias de aula</legend>
                          <div className="flex flex-wrap gap-1.5">
                            {[1, 2, 3, 4, 5, 6, 7].map((w) => {
                              const on = s.weekdays.includes(w);
                              return (
                                <button
                                  key={w}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() =>
                                    editSubject(s.key, {
                                      weekdays: on
                                        ? s.weekdays.filter((x) => x !== w)
                                        : [...s.weekdays, w].sort((a, b) => a - b),
                                    })
                                  }
                                  className={`min-h-9 rounded-md border px-3 text-sm transition-colors ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong bg-surface text-muted hover:bg-surface-2"}`}
                                >
                                  {WEEKDAYS_SHORT[w]}
                                </button>
                              );
                            })}
                          </div>
                        </fieldset>
                        {s.weekdays.length > 0 ? (
                          <div className="grid max-w-md grid-cols-2 gap-3">
                            <Field
                              id={`${id}-inicio`}
                              label="Começa às"
                              type="time"
                              value={s.startsAt}
                              onChange={(e) => editSubject(s.key, { startsAt: e.target.value })}
                            />
                            <Field
                              id={`${id}-fim`}
                              label="Termina às"
                              type="time"
                              value={s.endsAt}
                              onChange={(e) => editSubject(s.key, { endsAt: e.target.value })}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="confirmar">
            <h2 id="confirmar" className="text-lg font-semibold">
              5. Semestre
            </h2>
            <Field
              id="rotulo"
              label="Nome do semestre"
              value={semester.label}
              maxLength={60}
              required
              error={fields.label || undefined}
              hint="Se você já tiver um semestre com este nome, o novo ganha um número no fim."
              onChange={(e) => setSemesterEdits((x) => ({ ...x, label: e.target.value }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="inicio"
                label="Início das aulas"
                type="date"
                value={semester.startsOn}
                required
                error={fields.startsOn || undefined}
                onChange={(e) => setSemesterEdits((x) => ({ ...x, startsOn: e.target.value }))}
              />
              <Field
                id="fim"
                label="Fim das aulas"
                type="date"
                value={semester.endsOn}
                required
                error={fields.endsOn || undefined}
                onChange={(e) => setSemesterEdits((x) => ({ ...x, endsOn: e.target.value }))}
              />
            </div>

            {built.ok ? (
              <>
                <p className="text-sm" data-testid="resumo-importacao">
                  {plural(built.body.subjects.length, "matéria", "matérias")} ·{" "}
                  {plural(built.counts.absences, "falta", "faltas")}
                  {built.counts.presences > 0
                    ? ` · ${plural(built.counts.presences, "presença", "presenças")}`
                    : ""}
                  {built.counts.cancelled > 0
                    ? ` · ${plural(built.counts.cancelled, "aula cancelada", "aulas canceladas")}`
                    : ""}
                </p>
                {built.warnings.map((w) => (
                  <Alert key={w} tone="info">
                    {w}
                  </Alert>
                ))}
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                  Será criado um semestre novo de {formatDate(semester.startsOn)} a{" "}
                  {formatDate(semester.endsOn)}. Os semestres que você já tem não mudam. Motivos e
                  observações da planilha vão para as anotações de cada aula. Faltas antigas não
                  geram avisos.
                </p>
              </>
            ) : (
              <Alert tone="info">{built.error}</Alert>
            )}

            {error ? <Alert tone="error">{error}</Alert> : null}

            <Button
              type="button"
              loading={pending}
              disabled={!built.ok}
              onClick={() => built.ok && void submit(built.body)}
            >
              Importar semestre
            </Button>
          </section>
        </>
      ) : null}
    </>
  );
}
