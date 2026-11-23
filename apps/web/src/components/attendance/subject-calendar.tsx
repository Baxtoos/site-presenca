"use client";

import type {
  AttendanceDeleted,
  AttendanceRecord,
  AttendanceResult,
  CalendarClass,
  SubjectCalendar as CalendarData,
} from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import {
  formatDayLabel,
  plural,
  STATUS_LABEL,
  STATUS_STYLE,
  type AttendanceStatusKey,
} from "@/lib/format";
import { RecordEditor } from "./record-editor";

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
/** Domingo primeiro, como nos calendários brasileiros. */
const WEEK_HEADER = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEK_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Mark = { status: AttendanceStatusKey; unitsMissed?: number };
type DayState = "present" | "absent" | "partial" | "cancelled" | "blocked" | "todo" | "future";

const classKey = (c: CalendarClass) => c.scheduleId ?? `extra-${c.record?.id}`;

/** Cor de cada dia (classes literais, para o Tailwind gerar). */
const DAY_STYLE: Record<DayState, string> = {
  present: "bg-ok-soft text-ok border-transparent",
  absent: "bg-fail-soft text-fail border-transparent",
  partial: "bg-warn-soft text-warn border-transparent",
  cancelled: "bg-surface-2 text-muted border-transparent",
  blocked: "bg-surface-2 text-muted border-transparent line-through",
  todo: "bg-surface text-ink border-accent border-2",
  future: "bg-surface text-muted border-line border-dashed",
};

const LEGEND: { state: DayState; label: string }[] = [
  { state: "present", label: "Presença" },
  { state: "absent", label: "Falta" },
  { state: "partial", label: "Falta parcial" },
  { state: "todo", label: "Falta marcar" },
  { state: "blocked", label: "Feriado / sem aula" },
  { state: "future", label: "Ainda vai acontecer" },
];

/** Estado de um dia: o pior registro manda (falta > parcial > presença); sem registro, depende da data. */
function dayState(classes: CalendarClass[], date: string, today: string): DayState {
  const records = classes.map((c) => c.record).filter((r): r is AttendanceRecord => r !== null);
  const pending = classes.filter((c) => !c.record && !c.blocked);
  if (pending.length > 0) return date > today ? "future" : "todo";
  if (records.some((r) => r.status === "absent")) return "absent";
  if (records.some((r) => r.status === "partial")) return "partial";
  if (records.some((r) => r.status === "present")) return "present";
  if (records.length > 0) return "cancelled";
  return "blocked";
}

function successMessage(mark: Mark): string {
  switch (mark.status) {
    case "present":
      return "Presença registrada.";
    case "absent":
      return "Falta registrada.";
    case "partial":
      return `Falta de ${plural(mark.unitsMissed ?? 1, "aula", "aulas")} registrada.`;
    case "cancelled":
      return "Aula marcada como cancelada.";
  }
}

/** Dias do mês em semanas (domingo a sábado), com espaços vazios antes do dia 1. */
function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= lastDay; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Calendário do mês de uma matéria: os dias de aula aparecem coloridos pelo que foi registrado.
 * Tocar num dia abre as aulas dele para marcar presença, falta, falta parcial ou aula cancelada.
 */
export function SubjectCalendar({
  subjectId,
  initial,
}: {
  subjectId: string;
  initial: CalendarData;
}) {
  const router = useRouter();
  const toast = useToast();
  const [cal, setCal] = useState(initial);
  const [source, setSource] = useState(initial);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const firstSelected = initial.days.some((d) => d.date === initial.today) ? initial.today : null;
  const [selected, setSelected] = useState<string | null>(firstSelected);
  const [busy, setBusy] = useState<string>();
  const [picking, setPicking] = useState<string>();
  const [editing, setEditing] = useState<string>();

  // Dados novos do servidor (router.refresh): recomeça a partir deles, se for o mesmo mês.
  if (source !== initial) {
    setSource(initial);
    if (initial.month === cal.month) setCal(initial);
  }

  const byDate = useMemo(() => new Map(cal.days.map((d) => [d.date, d.classes])), [cal.days]);
  const grid = useMemo(() => monthGrid(cal.month), [cal.month]);
  const [year, monthNumber] = cal.month.split("-").map(Number) as [number, number];
  const selectedClasses = selected ? (byDate.get(selected) ?? []) : [];

  async function goTo(month: string | null) {
    if (!month) return;
    setLoadingMonth(true);
    try {
      const next = await api<CalendarData>(`/v1/subjects/${subjectId}/calendar?month=${month}`);
      setCal(next);
      setSelected(next.days.some((d) => d.date === next.today) ? next.today : null);
      setPicking(undefined);
      setEditing(undefined);
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível abrir o mês.",
      });
    } finally {
      setLoadingMonth(false);
    }
  }

  /** Atualiza o registro de uma aula e o resumo da matéria com a resposta da API. */
  function apply(
    date: string,
    key: string,
    record: AttendanceRecord | null,
    summary: CalendarData["summary"],
  ) {
    setCal((current) => ({
      ...current,
      summary,
      days: current.days
        .map((d) =>
          d.date !== date
            ? d
            : {
                ...d,
                classes: d.classes
                  .map((c) => (classKey(c) === key ? { ...c, record } : c))
                  // Aula extra apagada some do dia.
                  .filter((c) => c.scheduleId !== null || c.record !== null),
              },
        )
        .filter((d) => d.classes.length > 0),
    }));
  }

  function fail(e: unknown) {
    if (e instanceof ApiError && (e.problem.status === 409 || e.problem.status === 412)) {
      toast.push({ tone: "error", message: "Esta aula mudou em outro aparelho. Atualizei o mês." });
      void goTo(cal.month);
      return;
    }
    toast.push({
      tone: "error",
      message:
        e instanceof ApiError
          ? e.code === "NETWORK_ERROR"
            ? "Sem conexão. Para marcar sem internet, use a tela Hoje."
            : e.message
          : "Não foi possível salvar.",
    });
  }

  async function mark(date: string, c: CalendarClass, next: Mark) {
    const key = classKey(c);
    const previous = c.record;
    setBusy(key);
    setPicking(undefined);
    try {
      const result = previous
        ? await api<AttendanceResult>(`/v1/attendance/${previous.id}`, {
            method: "PATCH",
            body: next.status === "partial" ? next : { status: next.status },
            ifMatch: previous.version,
          })
        : await api<AttendanceResult>("/v1/attendance", {
            method: "POST",
            body: { subjectId, classDate: date, scheduleId: c.scheduleId, ...next },
            idempotencyKey: true,
          });
      apply(date, key, result.record, result.summary);
      toast.push({
        tone: "success",
        message: successMessage(next),
        actionLabel: "Desfazer",
        onAction: () => void undo(date, key, result.record, previous),
      });
      router.refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }

  async function remove(date: string, c: CalendarClass) {
    const r = c.record;
    if (!r) return;
    const key = classKey(c);
    setBusy(key);
    try {
      const { summary } = await api<AttendanceDeleted>(`/v1/attendance/${r.id}`, {
        method: "DELETE",
        ifMatch: r.version,
      });
      apply(date, key, null, summary);
      toast.push({ message: "Registro apagado." });
      router.refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }

  /** Volta ao que era: apaga o registro novo ou restaura o status anterior. */
  async function undo(
    date: string,
    key: string,
    current: AttendanceRecord,
    previous: AttendanceRecord | null,
  ) {
    setBusy(key);
    try {
      if (!previous) {
        const { summary } = await api<AttendanceDeleted>(`/v1/attendance/${current.id}`, {
          method: "DELETE",
          ifMatch: current.version,
        });
        apply(date, key, null, summary);
      } else {
        const absence = previous.status === "absent" || previous.status === "partial";
        const result = await api<AttendanceResult>(`/v1/attendance/${current.id}`, {
          method: "PATCH",
          ifMatch: current.version,
          body: {
            status: previous.status,
            ...(previous.status === "partial" ? { unitsMissed: previous.unitsMissed } : {}),
            ...(absence ? { isExcused: previous.isExcused, reason: previous.reason } : {}),
          },
        });
        apply(date, key, result.record, result.summary);
      }
      toast.push({ message: "Desfeito." });
      router.refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold" aria-live="polite">
          {MONTHS[monthNumber - 1]} {year}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void goTo(cal.prevMonth)}
            disabled={!cal.prevMonth || loadingMonth}
            aria-label="Mês anterior"
            className="grid size-11 place-items-center rounded-lg border border-line bg-surface text-lg hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronLeftIcon size={18} />
          </button>
          <button
            type="button"
            onClick={() => void goTo(cal.nextMonth)}
            disabled={!cal.nextMonth || loadingMonth}
            aria-label="Próximo mês"
            className="grid size-11 place-items-center rounded-lg border border-line bg-surface text-lg hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
      </div>

      <div
        className={`grid grid-cols-7 gap-1 sm:gap-1.5 ${loadingMonth ? "opacity-60" : ""}`}
        aria-busy={loadingMonth || undefined}
        data-testid="calendario"
      >
        {WEEK_HEADER.map((d, i) => (
          <div key={i} className="pb-1 text-center text-xs font-medium text-muted" aria-hidden>
            {d}
          </div>
        ))}
        {grid.map((date, i) => {
          if (!date) return <div key={`vazio-${i}`} aria-hidden />;
          const day = Number(date.slice(8));
          const classes = byDate.get(date);
          const inSemester = date >= cal.semester.startsOn && date <= cal.semester.endsOn;
          if (!classes) {
            return (
              <div
                key={date}
                className={`grid h-11 place-items-center rounded-lg text-sm tabular-nums sm:h-12 ${inSemester ? "text-muted" : "text-muted/50"}`}
                aria-hidden
              >
                {day}
              </div>
            );
          }
          const state = dayState(classes, date, cal.today);
          const label = LEGEND.find((l) => l.state === state)?.label ?? STATUS_LABEL.cancelled;
          const isSelected = selected === date;
          return (
            <button
              key={date}
              type="button"
              onClick={() => {
                setSelected(isSelected ? null : date);
                setPicking(undefined);
                setEditing(undefined);
              }}
              aria-pressed={isSelected}
              aria-label={`${WEEK_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()]}, ${day}: ${label}`}
              className={`relative grid h-11 place-items-center rounded-lg border sm:h-12 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${DAY_STYLE[state]} ${isSelected ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""} ${date === cal.today ? "underline decoration-2 underline-offset-4" : ""}`}
              data-estado={state}
            >
              {day}
              {classes.length > 1 ? (
                <span
                  className="absolute bottom-1 text-[10px] font-normal leading-none"
                  aria-hidden
                >
                  {"•".repeat(Math.min(classes.length, 3))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legenda">
        {LEGEND.map((l) => (
          <li key={l.state} className="flex items-center gap-1.5">
            <span
              className={`inline-block size-3.5 rounded border ${DAY_STYLE[l.state]}`}
              aria-hidden
            />
            {l.label}
          </li>
        ))}
      </ul>

      {selected ? (
        <section
          className="grid gap-3 rounded-xl border border-line bg-surface-2 p-4"
          aria-label={`Aulas de ${formatDayLabel(selected)}`}
          data-testid="dia-selecionado"
        >
          <h4 className="font-semibold capitalize">{formatDayLabel(selected)}</h4>
          {selectedClasses.map((c) => {
            const key = classKey(c);
            const r = c.record;
            const isBusy = busy === key;
            const future = selected > cal.today;
            const canPartial = c.units > 1;
            return (
              <div key={key} className="grid gap-2.5" aria-busy={isBusy || undefined}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted">
                    {[
                      c.startsAt ? `${c.startsAt}–${c.endsAt}` : "Aula extra",
                      plural(c.units, "aula", "aulas"),
                      c.room,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {r ? (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                    >
                      {r.status === "partial"
                        ? `Faltei ${r.unitsMissed} de ${c.units}`
                        : STATUS_LABEL[r.status]}
                      {r.isExcused ? " · abonada" : ""}
                    </span>
                  ) : null}
                </div>

                {c.blocked && !r ? (
                  <p className="text-sm text-muted">{c.blocked.label}: esta aula não conta.</p>
                ) : future && !r ? (
                  <p className="text-sm text-muted">Esta aula ainda não aconteceu.</p>
                ) : (
                  <>
                    <div
                      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                      role="group"
                      aria-label={`Registrar a aula de ${formatDayLabel(selected)}`}
                    >
                      {(["present", "absent", "partial", "cancelled"] as const)
                        .filter((st) => st !== "partial" || canPartial)
                        .map((st) => {
                          const active = r?.status === st && (st !== "partial" || picking !== key);
                          return (
                            <button
                              key={st}
                              type="button"
                              disabled={isBusy}
                              aria-pressed={active}
                              onClick={() => {
                                if (st !== "partial") return void mark(selected, c, { status: st });
                                if (c.units === 2)
                                  return void mark(selected, c, {
                                    status: "partial",
                                    unitsMissed: 1,
                                  });
                                setPicking(picking === key ? undefined : key);
                              }}
                              className={`min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
                                active
                                  ? `border-transparent ${STATUS_STYLE[st]}`
                                  : "border-line bg-surface hover:bg-surface-2"
                              }`}
                            >
                              {st === "partial" ? "Faltei parcial" : STATUS_LABEL[st]}
                            </button>
                          );
                        })}
                    </div>
                    {picking === key ? (
                      <div
                        className="flex flex-wrap items-center gap-2 text-sm"
                        role="group"
                        aria-label="Quantas aulas perdeu?"
                      >
                        <span className="text-muted">Perdi</span>
                        {Array.from({ length: c.units - 1 }, (_, i) => i + 1).map((n) => (
                          <button
                            key={n}
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void mark(selected, c, { status: "partial", unitsMissed: n })
                            }
                            className="min-h-11 min-w-11 rounded-lg border border-line bg-surface px-3 font-semibold hover:bg-surface-2"
                          >
                            {n}
                          </button>
                        ))}
                        <span className="text-muted">de {c.units} aulas</span>
                      </div>
                    ) : null}
                  </>
                )}

                {r && editing === r.id ? (
                  <RecordEditor
                    record={r}
                    onCancel={() => setEditing(undefined)}
                    onSaved={(result) => {
                      setEditing(undefined);
                      apply(selected, key, result.record, result.summary);
                      toast.push({ tone: "success", message: "Detalhes salvos." });
                      router.refresh();
                    }}
                  />
                ) : r ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setEditing(r.id)} disabled={isBusy}>
                      {r.status === "absent" || r.status === "partial"
                        ? "Motivo e atestado"
                        : "Observação"}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void remove(selected, c)}
                      disabled={isBusy}
                    >
                      Apagar registro
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : (
        <p className="text-sm text-muted">Toque num dia de aula para marcar presença ou falta.</p>
      )}
    </div>
  );
}
