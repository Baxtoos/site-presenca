"use client";

import type { AttendanceDeleted, AttendanceList, AttendanceRecord } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";
import {
  formatDayLabel,
  plural,
  REASON_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  type AttendanceStatusKey,
} from "@/lib/format";
import { RecordEditor } from "./record-editor";

const FILTERS: { value: AttendanceStatusKey | ""; label: string }[] = [
  { value: "", label: "Tudo" },
  { value: "absent", label: "Faltas" },
  { value: "partial", label: "Parciais" },
  { value: "present", label: "Presenças" },
  { value: "cancelled", label: "Canceladas" },
  { value: "no_call", label: "Sem chamada" },
];

/** Histórico de chamadas da matéria, do mais recente para o mais antigo, com edição e exclusão. */
export function AttendanceHistory({
  subjectId,
  initial,
}: {
  subjectId: string;
  initial: AttendanceList;
}) {
  const router = useRouter();
  const toast = useToast();
  const [records, setRecords] = useState(initial.records);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [source, setSource] = useState(initial);
  const [filter, setFilter] = useState<AttendanceStatusKey | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();

  // A página foi revalidada (ex.: registro feito em outro lugar) e estamos sem filtro: usa a lista nova.
  if (source !== initial) {
    setSource(initial);
    if (filter === "") {
      setRecords(initial.records);
      setCursor(initial.nextCursor);
    }
  }

  async function load(nextFilter: AttendanceStatusKey | "", after: string | null) {
    setLoading(true);
    setError(undefined);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (nextFilter) params.set("status", nextFilter);
      if (after) params.set("cursor", after);
      const page = await api<AttendanceList>(`/v1/subjects/${subjectId}/attendance?${params}`);
      setRecords((all) => (after ? [...all, ...page.records] : page.records));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(record: AttendanceRecord) {
    if (!window.confirm(`Apagar o registro de ${formatDayLabel(record.classDate)}?`)) return;
    setDeleting(record.id);
    try {
      await api<AttendanceDeleted>(`/v1/attendance/${record.id}`, {
        method: "DELETE",
        ifMatch: record.version,
      });
      setRecords((all) => all.filter((r) => r.id !== record.id));
      toast.push({ message: "Registro apagado." });
      router.refresh();
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível apagar.",
      });
      if (e instanceof ApiError && e.problem.status === 412) router.refresh();
    } finally {
      setDeleting(undefined);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar histórico">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => {
              setFilter(f.value);
              void load(f.value, null);
            }}
            className={`min-h-9 rounded-full border px-3 text-sm ${
              filter === f.value
                ? "border-accent bg-accent-soft font-semibold text-accent"
                : "border-line hover:bg-surface-2"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {records.length === 0 ? (
        <p className="text-sm text-muted">
          {filter ? "Nenhum registro com esse filtro." : "Nenhuma chamada registrada ainda."}
        </p>
      ) : (
        <ul className="grid divide-y divide-line" aria-label="Registros">
          {records.map((r) => (
            <li key={r.id} className="grid gap-2 py-3" data-testid="registro">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="tabular-nums">{formatDayLabel(r.classDate)}</strong>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status === "partial"
                      ? `Faltei ${r.unitsMissed} de ${r.unitsScheduled}`
                      : STATUS_LABEL[r.status]}
                  </span>
                  <span className="text-xs text-muted">
                    {[
                      r.scheduleId ? null : "aula extra",
                      plural(r.unitsScheduled, "aula", "aulas"),
                      r.isExcused ? "abonada" : null,
                      r.reason ? REASON_LABEL[r.reason] : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {editing === r.id ? null : (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(r.id)}
                      className="min-h-9 rounded-lg px-2 font-medium text-accent hover:bg-accent-soft"
                      aria-label={`Editar registro de ${formatDayLabel(r.classDate)}`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={deleting === r.id}
                      onClick={() => void remove(r)}
                      className="min-h-9 rounded-lg px-2 font-medium text-fail hover:bg-fail-soft disabled:opacity-60"
                      aria-label={`Apagar registro de ${formatDayLabel(r.classDate)}`}
                    >
                      Apagar
                    </button>
                  </span>
                )}
              </div>
              {r.content && editing !== r.id ? (
                <p className="whitespace-pre-wrap text-sm" data-testid="conteudo-da-aula">
                  <span className="font-medium">Conteúdo: </span>
                  {r.content}
                </p>
              ) : null}
              {r.note && editing !== r.id ? <p className="text-sm text-muted">{r.note}</p> : null}
              {editing === r.id ? (
                <RecordEditor
                  record={r}
                  allowStatus
                  onCancel={() => setEditing(undefined)}
                  onSaved={({ record }) => {
                    setEditing(undefined);
                    setRecords((all) => all.map((x) => (x.id === record.id ? record : x)));
                    toast.push({ tone: "success", message: "Registro atualizado." });
                    router.refresh();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          onClick={() => void load(filter, cursor)}
          className="w-fit"
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}

/** Registra uma aula fora da grade (reposição, aula extra), em qualquer dia do semestre até hoje. */
export function ExtraClassForm({
  subjectId,
  defaultUnits,
  today,
}: {
  subjectId: string;
  defaultUnits: number;
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState<AttendanceStatusKey>("present");
  const [units, setUnits] = useState(defaultUnits);
  const [missed, setMissed] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const selectClass =
    "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base outline-none hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:min-h-10 sm:text-sm";

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="w-fit">
        Registrar aula extra
      </Button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await api("/v1/attendance", {
        method: "POST",
        idempotencyKey: true,
        body: {
          subjectId,
          classDate: date,
          status,
          unitsScheduled: units,
          ...(status === "partial" ? { unitsMissed: Math.min(missed, units - 1) } : {}),
        },
      });
      toast.push({ tone: "success", message: "Aula extra registrada." });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (Object.values(e.fieldErrors)[0] ?? e.message)
          : "Não foi possível salvar.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={(e) => void submit(e)}
      className="grid gap-3 rounded-xl bg-surface-2 p-4 text-sm"
      noValidate
    >
      <p className="font-semibold">Aula extra ou reposição</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1.5 font-medium">
          Dia
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            required
            className={selectClass}
          />
        </label>
        <label className="grid min-w-0 gap-1.5 font-medium">
          Aulas no dia
          <select
            value={units}
            onChange={(e) => {
              const n = Number(e.target.value);
              setUnits(n);
              if (n === 1 && status === "partial") setStatus("absent");
            }}
            className={selectClass}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 font-medium">
          O que aconteceu
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatusKey)}
            className={selectClass}
          >
            {(Object.keys(STATUS_LABEL) as AttendanceStatusKey[])
              .filter((s) => s !== "partial" || units > 1)
              .map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
          </select>
        </label>
      </div>
      {status === "partial" && units > 1 ? (
        <label className="grid max-w-xs min-w-0 gap-1.5 font-medium">
          Aulas perdidas
          <select
            value={missed}
            onChange={(e) => setMissed(Number(e.target.value))}
            className={selectClass}
          >
            {Array.from({ length: units - 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          Registrar
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
