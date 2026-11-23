"use client";

import { SUBJECT_COLORS, type Subject } from "@presenca/contracts";
import { maxAbsenceUnits, type SubjectRules, totalUnits } from "@presenca/engine";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import {
  bpToPercent,
  parseDecimal,
  percentToBp,
  plural,
  SUBJECT_COLOR_CLASS,
  SUBJECT_COLOR_NAME,
  WEEKDAYS,
} from "@/lib/format";

type Mode = "workload" | "class_count" | "manual";

interface Draft {
  name: string;
  code: string;
  professor: string;
  color: string;
  mode: Mode;
  totalClasses: string;
  workloadHours: string;
  workloadHourMinutes: string;
  unitMinutes: string;
  minPercent: string;
  manualMaxUnits: string;
  unitsPerClass: string;
  excusedPolicy: "track_only" | "deduct";
}

function initialDraft(subject?: Subject): Draft {
  if (!subject) {
    return {
      name: "",
      code: "",
      professor: "",
      color: "blue",
      mode: "workload",
      totalClasses: "",
      workloadHours: "60",
      workloadHourMinutes: "60",
      unitMinutes: "50",
      minPercent: "75",
      manualMaxUnits: "",
      unitsPerClass: "2",
      excusedPolicy: "track_only",
    };
  }
  return {
    name: subject.name,
    code: subject.code ?? "",
    professor: subject.professor ?? "",
    color: subject.color ?? "blue",
    mode: subject.countingMode,
    totalClasses: subject.totalClasses?.toString() ?? "",
    workloadHours: subject.workloadHours?.toString().replace(".", ",") ?? "60",
    workloadHourMinutes: subject.workloadHourMinutes?.toString() ?? "60",
    unitMinutes: subject.unitMinutes?.toString() ?? "50",
    minPercent: (subject.minAttendanceBp / 100).toString().replace(".", ","),
    manualMaxUnits: subject.manualMaxUnits?.toString() ?? "",
    unitsPerClass: subject.unitsPerClass.toString(),
    excusedPolicy: subject.excusedPolicy,
  };
}

/** Rascunho → corpo da API. A API valida de novo (e é a palavra final). */
function toBody(d: Draft) {
  const base = {
    name: d.name,
    code: d.code || null,
    professor: d.professor || null,
    color: d.color || null,
    unitsPerClass: Number(d.unitsPerClass),
    excusedPolicy: d.excusedPolicy,
  };
  switch (d.mode) {
    case "class_count":
      return {
        ...base,
        countingMode: d.mode,
        totalClasses: Number(d.totalClasses),
        minAttendanceBp: percentToBp(d.minPercent),
      };
    case "workload":
      return {
        ...base,
        countingMode: d.mode,
        workloadHours: parseDecimal(d.workloadHours),
        workloadHourMinutes: Number(d.workloadHourMinutes),
        unitMinutes: Number(d.unitMinutes),
        minAttendanceBp: percentToBp(d.minPercent),
      };
    case "manual":
      return {
        ...base,
        countingMode: d.mode,
        manualMaxUnits: Number(d.manualMaxUnits),
        totalClasses: d.totalClasses ? Number(d.totalClasses) : null,
      };
  }
}

/** Mesmas regras, no formato do motor — para a prévia ao vivo. */
function toRules(d: Draft): SubjectRules {
  const unitsPerClass = Number(d.unitsPerClass);
  const minAttendanceBp = percentToBp(d.minPercent);
  switch (d.mode) {
    case "class_count":
      return { mode: d.mode, totalClasses: Number(d.totalClasses), unitsPerClass, minAttendanceBp };
    case "workload":
      return {
        mode: d.mode,
        workloadHours: parseDecimal(d.workloadHours),
        workloadHourMinutes: Number(d.workloadHourMinutes),
        unitMinutes: Number(d.unitMinutes),
        unitsPerClass,
        minAttendanceBp,
      };
    case "manual":
      return {
        mode: d.mode,
        manualMaxUnits: Number(d.manualMaxUnits),
        unitsPerClass,
        ...(d.totalClasses ? { totalClasses: Number(d.totalClasses) } : {}),
      };
  }
}

function Preview({ draft }: { draft: Draft }) {
  const result = useMemo(() => {
    try {
      const rules = toRules(draft);
      if (rules.mode === "class_count" && rules.totalClasses < 1) return null;
      return { T: totalUnits(rules), F: maxAbsenceUnits(rules), upc: rules.unitsPerClass };
    } catch {
      return null;
    }
  }, [draft]);

  if (!result) {
    return (
      <div
        className="rounded-xl border border-dashed border-line p-4 text-sm text-muted"
        aria-live="polite"
      >
        Preencha as regras para ver quantas faltas você pode ter.
      </div>
    );
  }
  const classes = Math.floor(result.F / result.upc);
  return (
    <div
      className="grid gap-1 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm"
      aria-live="polite"
      data-testid="previa"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">Com essas regras</p>
      <p className="text-base">
        Você pode faltar até{" "}
        <strong className="text-lg tabular-nums">{plural(result.F, "aula", "aulas")}</strong>
        {result.upc > 1 ? (
          <>
            {" "}
            ({plural(classes, "dia", "dias")} de {result.upc} aulas)
          </>
        ) : null}
        .
      </p>
      {result.T !== null ? (
        <p className="text-muted">
          O semestre tem {plural(result.T, "aula", "aulas")} de chamada
          {draft.mode !== "manual"
            ? `; para passar, precisa de ${bpToPercent(percentToBp(draft.minPercent))} de presença`
            : ""}
          . Frações são arredondadas para baixo, a seu favor.
        </p>
      ) : null}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base outline-none hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:min-h-10 sm:text-sm"
      >
        {children}
      </select>
    </label>
  );
}

const MODES: { value: Mode; title: string; hint: string }[] = [
  { value: "workload", title: "Carga horária", hint: "Ex.: 60 h, aulas de 50 min" },
  { value: "class_count", title: "Número de aulas", hint: "Ex.: 36 aulas no semestre" },
  { value: "manual", title: "Limite fixo", hint: "O professor disse o máximo" },
];

/** Campos de dados e regras da matéria, com a prévia ao vivo. */
function SubjectFields({
  draft,
  set,
  errors,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  errors: Record<string, string>;
}) {
  const text = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
  });

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-4">
        <legend className="mb-2 font-semibold">Matéria</legend>
        <Field id="nome-materia" label="Nome" required error={errors.name} {...text("name")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="professor"
            label="Professor(a)"
            error={errors.professor}
            {...text("professor")}
          />
          <Field id="codigo" label="Código (opcional)" error={errors.code} {...text("code")} />
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Cor</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da matéria">
            {SUBJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={draft.color === c}
                aria-label={SUBJECT_COLOR_NAME[c]}
                onClick={() => set("color", c)}
                className={`size-8 rounded-full ${SUBJECT_COLOR_CLASS[c]} ring-offset-2 ring-offset-surface ${draft.color === c ? "ring-2 ring-ink" : ""}`}
              />
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 font-semibold">Como a faculdade conta as faltas</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Modo de contagem">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={draft.mode === m.value}
              onClick={() => set("mode", m.value)}
              className={`grid gap-0.5 rounded-xl border p-3 text-left text-sm transition-colors ${draft.mode === m.value ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2"}`}
            >
              <span className="font-semibold">{m.title}</span>
              <span className="text-xs text-muted">{m.hint}</span>
            </button>
          ))}
        </div>

        {draft.mode === "workload" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="carga"
              label="Carga horária (h)"
              inputMode="decimal"
              error={errors.workloadHours}
              {...text("workloadHours")}
            />
            <Select
              id="tipo-hora"
              label="Tipo de hora"
              value={draft.workloadHourMinutes}
              onChange={(v) => set("workloadHourMinutes", v)}
            >
              <option value="60">Hora-relógio (60 min)</option>
              <option value="50">Hora-aula de 50 min</option>
              <option value="45">Hora-aula de 45 min</option>
            </Select>
            <Field
              id="duracao-tempo"
              label="Cada chamada vale (min)"
              inputMode="numeric"
              hint="Duração de 1 aula"
              error={errors.unitMinutes}
              {...text("unitMinutes")}
            />
          </div>
        ) : null}

        {draft.mode === "class_count" ? (
          <Field
            id="total-aulas"
            label="Total de dias de aula no semestre"
            inputMode="numeric"
            error={errors.totalClasses}
            {...text("totalClasses")}
          />
        ) : null}

        {draft.mode === "manual" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="limite-manual"
              label="Máximo de faltas (aulas)"
              inputMode="numeric"
              error={errors.manualMaxUnits}
              {...text("manualMaxUnits")}
            />
            <Field
              id="total-aulas"
              label="Total de dias de aula (opcional)"
              inputMode="numeric"
              hint="Permite calcular sua presença final"
              error={errors.totalClasses}
              {...text("totalClasses")}
            />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {draft.mode !== "manual" ? (
            <Field
              id="presenca-minima"
              label="Presença mínima (%)"
              inputMode="decimal"
              hint="O padrão é 75%; laboratórios costumam pedir mais"
              error={errors.minAttendanceBp}
              {...text("minPercent")}
            />
          ) : null}
          <Select
            id="tempos-encontro"
            label="Aulas por dia"
            value={draft.unitsPerClass}
            onChange={(v) => set("unitsPerClass", v)}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 (uma chamada por aula)" : `${n} (aula geminada)`}
              </option>
            ))}
          </Select>
        </div>

        <Select
          id="atestado"
          label="Falta com atestado"
          value={draft.excusedPolicy}
          onChange={(v) => set("excusedPolicy", v as Draft["excusedPolicy"])}
        >
          <option value="track_only">Conta no limite (só registro pessoal)</option>
          <option value="deduct">Não conta no limite (a faculdade abona)</option>
        </Select>

        <Preview draft={draft} />
      </fieldset>
    </div>
  );
}

interface ScheduleDraft {
  key: number;
  weekday: string;
  startsAt: string;
  endsAt: string;
  units: string;
  room: string;
}

/** Linhas da grade (rascunho, gravadas junto com a matéria). */
export function ScheduleRows({
  rows,
  onChange,
  errors,
  defaultUnits,
}: {
  rows: ScheduleDraft[];
  onChange: (rows: ScheduleDraft[]) => void;
  errors: Record<string, string>;
  defaultUnits: string;
}) {
  const update = (key: number, patch: Partial<ScheduleDraft>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Sem horários. Você pode adicionar depois.</p>
      ) : null}
      {rows.map((row, i) => (
        <div
          key={row.key}
          className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_1fr_auto] sm:items-end"
        >
          <Select
            id={`dia-${row.key}`}
            label="Dia"
            value={row.weekday}
            onChange={(v) => update(row.key, { weekday: v })}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {WEEKDAYS[d]}
              </option>
            ))}
          </Select>
          <Field
            id={`inicio-${row.key}`}
            label="Início"
            type="time"
            value={row.startsAt}
            error={errors[`schedules.${i}.startsAt`]}
            onChange={(e) => update(row.key, { startsAt: e.target.value })}
          />
          <Field
            id={`fim-${row.key}`}
            label="Fim"
            type="time"
            value={row.endsAt}
            error={errors[`schedules.${i}.endsAt`]}
            onChange={(e) => update(row.key, { endsAt: e.target.value })}
          />
          <Select
            id={`tempos-${row.key}`}
            label="Aulas"
            value={row.units}
            onChange={(v) => update(row.key, { units: v })}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Field
            id={`sala-${row.key}`}
            label="Sala"
            value={row.room}
            onChange={(e) => update(row.key, { room: e.target.value })}
          />
          <Button
            type="button"
            variant="danger"
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
            aria-label={`Remover horário de ${WEEKDAYS[Number(row.weekday)]}`}
          >
            Remover
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        className="w-fit"
        onClick={() =>
          onChange([
            ...rows,
            {
              key: Date.now(),
              weekday: String(
                rows.length === 0 ? 1 : Math.min(7, Number(rows.at(-1)!.weekday) + 2),
              ),
              startsAt: "19:00",
              endsAt: "20:40",
              units: defaultUnits,
              room: rows.at(-1)?.room ?? "",
            },
          ])
        }
      >
        Adicionar horário
      </Button>
    </div>
  );
}

function useDraft(subject?: Subject) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(subject));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return { draft, set };
}

/** Assistente de nova matéria: dados, regras com prévia e grade, gravados de uma vez. */
export function NewSubjectWizard({ semesterId }: { semesterId: string }) {
  const router = useRouter();
  const { draft, set } = useDraft();
  const [rows, setRows] = useState<ScheduleDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setErrors({});
    try {
      await api(`/v1/semesters/${semesterId}/subjects`, {
        method: "POST",
        body: {
          ...toBody(draft),
          schedules: rows.map((r) => ({
            weekday: Number(r.weekday),
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            units: Number(r.units),
            room: r.room || null,
          })),
        },
      });
      router.push(`/semestres/${semesterId}`);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setErrors(e.fieldErrors);
      setError(e.problem.errors ? "Revise os campos marcados." : e.message);
      setPending(false);
    }
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="grid gap-6" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <section className="card p-5 sm:p-6">
        <SubjectFields draft={draft} set={set} errors={errors} />
      </section>
      <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="grade">
        <div className="grid gap-1">
          <h2 id="grade" className="text-lg font-semibold tracking-tight">
            Horários na semana
          </h2>
          <p className="text-sm text-muted">
            Com a grade, o app sabe quais aulas você tem a cada dia.
          </p>
        </div>
        <ScheduleRows
          rows={rows}
          onChange={setRows}
          errors={errors}
          defaultUnits={draft.unitsPerClass}
        />
      </section>
      <Button type="submit" loading={pending} className="sm:w-fit">
        Salvar matéria
      </Button>
    </form>
  );
}

/** Edição de dados e regras de uma matéria existente (a grade é editada à parte). */
export function EditSubjectForm({ subject }: { subject: Subject }) {
  const router = useRouter();
  const toast = useToast();
  const { draft, set } = useDraft(subject);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setErrors({});
    try {
      await api(`/v1/subjects/${subject.id}`, {
        method: "PUT",
        body: toBody(draft),
        ifMatch: subject.version,
      });
      // Aviso flutuante: o formulário é recriado quando a versão da matéria muda (router.refresh).
      toast.push({ tone: "success", message: "Matéria atualizada." });
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setErrors(e.fieldErrors);
      setError(e.problem.errors ? "Revise os campos marcados." : e.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <SubjectFields draft={draft} set={set} errors={errors} />
      <Button type="submit" loading={pending} className="sm:w-fit">
        Salvar alterações
      </Button>
    </form>
  );
}
