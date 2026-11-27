"use client";

import type {
  AttendanceDeleted,
  AttendanceRecord,
  AttendanceResult,
  SubjectSummaryDto,
  TodayClass,
  TodayResponse,
} from "@presenca/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useOffline } from "@/components/offline-provider";
import { RiskLine } from "@/components/subject-card";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";
import {
  formatDayLabel,
  plural,
  REASON_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_STYLE,
  SUBJECT_COLOR_CLASS,
  type AttendanceStatusKey,
} from "@/lib/format";
import { RecordEditor } from "./record-editor";

type Mark = { status: AttendanceStatusKey; unitsMissed?: number };

const keyOf = (c: TodayClass) => c.scheduleId ?? `extra-${c.record?.id}`;

async function createOnce(body: Record<string, unknown>, key: string): Promise<AttendanceResult> {
  const send = () =>
    api<AttendanceResult>("/v1/attendance", { method: "POST", body, idempotencyKey: key });
  try {
    return await send();
  } catch (e) {
    if (e instanceof ApiError && e.code === "NETWORK_ERROR") return send();
    throw e;
  }
}

const noopSubscribe = () => () => {};
const deviceToday = () => new Intl.DateTimeFormat("en-CA").format(new Date());

function vibrate() {
  try {
    navigator.vibrate?.(15);
  } catch {}
}

function successMessage(mark: Mark, subject: string) {
  switch (mark.status) {
    case "present":
      return `Presença em ${subject}.`;
    case "absent":
      return `Falta registrada em ${subject}.`;
    case "partial":
      return `Falta de ${plural(mark.unitsMissed ?? 1, "aula", "aulas")} em ${subject}.`;
    case "cancelled":
      return `Aula de ${subject} marcada como cancelada.`;
    case "no_call":
      return `Aula de ${subject} sem chamada (sem falta).`;
  }
}

export function TodayPanel({ data, compact = false }: { data: TodayResponse; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [classes, setClasses] = useState(data.classes);
  const [source, setSource] = useState(data);
  const [busy, setBusy] = useState<string>();
  const [picking, setPicking] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const offline = useOffline();
  const today = useSyncExternalStore(noopSubscribe, deviceToday, () => data.date);

  const pendingFor = (c: TodayClass) =>
    offline.pending.find(
      (p) =>
        p.subjectId === c.subject.id && p.scheduleId === c.scheduleId && p.classDate === data.date,
    );

  if (source !== data) {
    setSource(data);
    setClasses(data.classes);
  }

  function apply(
    subjectId: string,
    key: string,
    record: AttendanceRecord | null,
    summary: SubjectSummaryDto,
  ) {
    setClasses((all) =>
      all.map((c) => {
        if (c.subject.id !== subjectId) return c;
        return keyOf(c) === key ? { ...c, record, summary } : { ...c, summary };
      }),
    );
  }

  function fail(e: unknown) {
    if (e instanceof ApiError && (e.problem.status === 409 || e.problem.status === 412)) {
      toast.push({
        tone: "error",
        message: "Esta aula mudou em outro aparelho. Atualizei a lista.",
      });
      router.refresh();
      return;
    }
    toast.push({
      tone: "error",
      message: e instanceof ApiError ? e.message : "Não foi possível salvar.",
    });
  }

  async function mark(c: TodayClass, next: Mark) {
    const key = keyOf(c);
    const previous = c.record;
    setBusy(key);
    setPicking(undefined);

    const queued = previous ? undefined : pendingFor(c);
    if (queued) {
      try {
        const newKey = await offline.replace(queued.key, next);
        vibrate();
        toast.push({
          message: `${successMessage(next, c.subject.name)} Vai quando a internet voltar.`,
          actionLabel: "Desfazer",
          onAction: () =>
            void offline.replace(newKey, {
              status: queued.status,
              unitsMissed: queued.unitsMissed,
            }),
        });
      } catch (e) {
        fail(e);
      } finally {
        setBusy(undefined);
      }
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    try {
      const result = previous
        ? await api<AttendanceResult>(`/v1/attendance/${previous.id}`, {
            method: "PATCH",
            body: next.status === "partial" ? next : { status: next.status },
            ifMatch: previous.version,
          })
        : await createOnce(
            { subjectId: c.subject.id, classDate: data.date, scheduleId: c.scheduleId, ...next },
            idempotencyKey,
          );
      apply(c.subject.id, key, result.record, result.summary);
      vibrate();
      toast.push({
        tone: "success",
        message: successMessage(next, c.subject.name),
        actionLabel: "Desfazer",
        onAction: () => void undo(c.subject.id, key, result.record, previous),
      });
      router.refresh();
    } catch (e) {
      if (!previous && e instanceof ApiError && e.code === "NETWORK_ERROR") {
        await queueOffline(c, next, idempotencyKey);
      } else {
        fail(e);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function queueOffline(c: TodayClass, next: Mark, idempotencyKey: string) {
    try {
      await offline.enqueue({
        key: idempotencyKey,
        subjectId: c.subject.id,
        subjectName: c.subject.name,
        classDate: data.date,
        scheduleId: c.scheduleId,
        status: next.status,
        ...(next.status === "partial" ? { unitsMissed: next.unitsMissed } : {}),
      });
      vibrate();
      toast.push({
        message: `${successMessage(next, c.subject.name)} Sem conexão: fica guardado e vai quando a internet voltar.`,
        actionLabel: "Desfazer",
        onAction: () => void offline.discard(idempotencyKey),
        duration: 8_000,
      });
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof Error ? e.message : "Sem conexão e sem como guardar no aparelho.",
      });
    }
  }

  async function undo(
    subjectId: string,
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
        apply(subjectId, key, null, summary);
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
        apply(subjectId, key, result.record, result.summary);
      }
      toast.push({ message: "Desfeito." });
      router.refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }

  const stale =
    data.isToday && today !== data.date ? (
      <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm" role="status">
        Estas são as aulas de <strong>{formatDayLabel(data.date)}</strong>, guardadas no aparelho.
        Conecte-se para ver as de hoje.
      </p>
    ) : null;

  if (classes.length === 0) {
    return (
      <>
        {stale}
        <div className="grid gap-2 rounded-xl border border-dashed border-line bg-surface p-5 text-sm">
          {data.exceptions.length > 0 ? (
            <p>
              <strong>{data.exceptions[0]!.label}</strong>: sem aula
              {data.isToday ? " hoje" : " neste dia"}.
            </p>
          ) : (
            <p className="text-muted">
              Nenhuma aula na grade {data.isToday ? "hoje" : "neste dia"}.
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {stale}
      <ul className="grid gap-3">
        {classes.map((c) => {
          const key = keyOf(c);
          const r = c.record;
          const queued = r ? undefined : pendingFor(c);
          const shown = r ?? queued;
          const isBusy = busy === key;
          const canPartial = c.units > 1;
          return (
            <li
              key={key}
              className="relative grid gap-3 overflow-hidden card p-4 pl-5"
              aria-busy={isBusy || undefined}
              data-testid="aula"
            >
              <span
                className={`absolute inset-y-0 left-0 w-1.5 ${c.subject.color ? SUBJECT_COLOR_CLASS[c.subject.color] : "bg-line"}`}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-0.5">
                  <h3 className="truncate font-semibold">
                    <Link href={`/materias/${c.subject.id}`} className="hover:text-accent">
                      {c.subject.name}
                    </Link>
                  </h3>
                  <p className="truncate text-xs text-muted">
                    {[
                      c.startsAt ? `${c.startsAt}–${c.endsAt}` : "Aula extra",
                      plural(c.units, "aula", "aulas"),
                      c.room,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {shown ? (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[shown.status]} ${queued ? "ring-1 ring-current ring-dashed" : ""}`}
                  >
                    {shown.status === "partial"
                      ? `Faltei ${shown.unitsMissed} de ${c.units}`
                      : STATUS_LABEL[shown.status]}
                    {queued ? " · não enviado" : ""}
                  </span>
                ) : null}
              </div>

              {c.blocked && !r ? (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
                  {c.blocked.label}: aula não conta.
                </p>
              ) : (
                <>
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    role="group"
                    aria-label={`Registrar ${c.subject.name}`}
                  >
                    {(["present", "absent", "partial", "no_call", "cancelled"] as const)
                      .filter((s) => s !== "partial" || canPartial)
                      .map((s) => {
                        const active = shown?.status === s && (s !== "partial" || picking !== key);
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={isBusy}
                            aria-pressed={active}
                            title={STATUS_HINT[s]}
                            onClick={() => {
                              if (s !== "partial") return void mark(c, { status: s });
                              if (c.units === 2)
                                return void mark(c, { status: "partial", unitsMissed: 1 });
                              setPicking(picking === key ? undefined : key);
                            }}
                            className={`min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
                              active
                                ? `border-transparent ${STATUS_STYLE[s]}`
                                : "border-line bg-surface hover:bg-surface-2"
                            }`}
                          >
                            {s === "partial" ? "Faltei parcial" : STATUS_LABEL[s]}
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
                          onClick={() => void mark(c, { status: "partial", unitsMissed: n })}
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

              {r?.content && editing !== r.id ? (
                <p
                  className="whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm"
                  data-testid="conteudo-da-aula"
                >
                  <span className="font-medium">Conteúdo: </span>
                  {r.content}
                </p>
              ) : null}
              {r && editing === r.id ? (
                <RecordEditor
                  record={r}
                  onCancel={() => setEditing(undefined)}
                  onSaved={(result) => {
                    setEditing(undefined);
                    apply(c.subject.id, key, result.record, result.summary);
                    toast.push({ tone: "success", message: "Detalhes salvos." });
                    router.refresh();
                  }}
                />
              ) : null}

              {!compact || shown ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <RiskLine summary={c.summary} unitsPerClass={c.subject.unitsPerClass} short />
                    {r?.isExcused ? " · abonada" : ""}
                    {r?.reason ? ` · ${REASON_LABEL[r.reason]}` : ""}
                    {queued ? " · conta quando for enviado" : ""}
                  </span>
                  {r && editing !== r.id ? (
                    <button
                      type="button"
                      onClick={() => setEditing(r.id)}
                      className="min-h-9 rounded-lg px-2 font-medium text-accent hover:bg-accent-soft"
                    >
                      {r.content
                        ? "Editar conteúdo"
                        : r.status === "absent" || r.status === "partial"
                          ? "Conteúdo, motivo e atestado"
                          : "Anotar o conteúdo da aula"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
