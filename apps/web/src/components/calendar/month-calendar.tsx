"use client";

import type { CalendarDay } from "@presenca/contracts";
import type { MonthGrid } from "@presenca/engine";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui";
import { dayLong, EXCEPTION_LABEL, monthLong, TONE, taskTone } from "@/lib/calendar";
import { SUBJECT_COLOR_CLASS } from "@/lib/format";
import { TaskRow } from "./task-row";

const WEEKDAYS = [
  ["Seg", "segunda"],
  ["Ter", "terça"],
  ["Qua", "quarta"],
  ["Qui", "quinta"],
  ["Sex", "sexta"],
  ["Sáb", "sábado"],
  ["Dom", "domingo"],
] as const;

const navClass =
  "inline-flex min-h-10 items-center gap-1 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink";

export function MonthCalendar({
  grid,
  days,
  today,
  prevHref,
  nextHref,
  todayHref,
}: {
  grid: MonthGrid;
  days: CalendarDay[];
  today: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const inMonth = (date: string) => date >= grid.first && date <= grid.last;
  const [selected, setSelected] = useState(inMonth(today) ? today : grid.first);
  const [showClasses, setShowClasses] = useState(true);
  const pathname = usePathname();
  const params = useSearchParams();
  const here = params.size > 0 ? `${pathname}?${params}` : pathname;
  const day = byDate.get(selected);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={prevHref} scroll={false} className={navClass} aria-label="Mês anterior">
            <ChevronLeftIcon size={18} />
          </Link>
          <h3
            className="min-w-40 text-center text-base font-semibold first-letter:uppercase"
            aria-live="polite"
          >
            {monthLong(grid.month)}
          </h3>
          <Link href={nextHref} scroll={false} className={navClass} aria-label="Próximo mês">
            <ChevronRightIcon size={18} />
          </Link>
          <Link
            href={todayHref}
            scroll={false}
            className={`${navClass} border border-line`}
            aria-label="Voltar para o mês de hoje"
          >
            Hoje
          </Link>
        </div>
        <label className="inline-flex min-h-10 items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showClasses}
            onChange={(e) => setShowClasses(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          Mostrar aulas
        </label>
      </div>

      <table className="w-full table-fixed border-collapse text-sm" data-testid="calendario-mes">
        <caption className="sr-only">
          Calendário de {monthLong(grid.month)}. Escolha um dia para ver as aulas e as tarefas.
        </caption>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th key={short} scope="col" className="pb-1 text-xs font-medium text-muted">
                <abbr title={long} className="no-underline">
                  {short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                const info = byDate.get(date);
                const tasks = info?.tasks ?? [];
                const classes = showClasses ? (info?.classes ?? []) : [];
                const exceptions = info?.exceptions ?? [];
                const blocked = exceptions.some((e) => e.kind !== "exam_week");
                const isSelected = date === selected;
                const isToday = date === today;
                const label = [
                  dayLong(date),
                  ...exceptions.map((e) => `${EXCEPTION_LABEL[e.kind]}: ${e.label}`),
                  classes.length > 0
                    ? `${classes.length} ${classes.length === 1 ? "aula" : "aulas"}`
                    : null,
                  tasks.length > 0
                    ? `${tasks.length} ${tasks.length === 1 ? "tarefa" : "tarefas"}`
                    : null,
                  tasks.some((t) => taskTone(t) === "overdue") ? "com atrasada" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                const room = 3 - (exceptions.length > 0 ? 1 : 0);
                const shownClasses = classes.slice(
                  0,
                  Math.min(classes.length, tasks.length > 0 ? 1 : room),
                );
                const shownTasks = tasks.slice(0, room - shownClasses.length);
                const hidden =
                  classes.length - shownClasses.length + tasks.length - shownTasks.length;
                return (
                  <td key={date} className="border border-line p-0 align-top">
                    <button
                      type="button"
                      onClick={() => setSelected(date)}
                      aria-pressed={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      data-date={date}
                      className={`flex h-14 w-full flex-col items-stretch gap-0.5 p-1 text-left transition-colors sm:h-28 ${isSelected ? "bg-accent-soft" : blocked ? "bg-warn-soft/50 hover:bg-warn-soft" : "hover:bg-surface-2"} ${inMonth(date) ? "" : "text-muted"} ${!inMonth(date) && !isSelected && !blocked ? "bg-surface-2/50" : ""}`}
                    >
                      <span
                        className={`grid size-6 place-items-center self-center rounded-full text-xs tabular-nums sm:self-start ${isToday ? "bg-accent font-semibold text-accent-ink" : blocked ? "font-semibold text-warn" : ""}`}
                      >
                        {Number(date.slice(8))}
                      </span>
                      {}
                      <span className="sr-only">, {label}</span>
                      {}
                      <span className="flex flex-wrap justify-center gap-0.5 sm:hidden" aria-hidden>
                        {classes.slice(0, 3).map((c, i) => (
                          <span
                            key={`a${i}`}
                            className={`size-1.5 rounded-[2px] ${c.color ? SUBJECT_COLOR_CLASS[c.color] : "bg-line-strong"} ${c.state === "pending" ? "ring-1 ring-warn" : ""}`}
                          />
                        ))}
                        {tasks.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className={`size-1.5 rounded-full ${TONE[taskTone(t)].dot}`}
                          />
                        ))}
                      </span>
                      {}
                      <span className="hidden min-w-0 gap-0.5 sm:grid" aria-hidden>
                        {exceptions.slice(0, 1).map((e) => (
                          <span
                            key={e.label}
                            className="truncate text-[11px] font-medium text-warn"
                          >
                            {e.label}
                          </span>
                        ))}
                        {shownClasses.map((c, i) => (
                          <span
                            key={`a${i}`}
                            className={`flex min-w-0 items-center gap-1 text-[11px] leading-4 ${c.state === "pending" ? "text-warn" : "text-muted"}`}
                          >
                            <span
                              className={`size-1.5 shrink-0 rounded-[2px] ${c.color ? SUBJECT_COLOR_CLASS[c.color] : "bg-line-strong"}`}
                            />
                            <span className="truncate">
                              {c.startsAt} {c.subjectName}
                            </span>
                          </span>
                        ))}
                        {shownTasks.map((t) => (
                          <span
                            key={t.id}
                            className={`truncate rounded border px-1 text-[11px] leading-4 ${TONE[taskTone(t)].chip}`}
                          >
                            {t.title}
                          </span>
                        ))}
                        {hidden > 0 ? (
                          <span className="text-[11px] text-muted">+{hidden}</span>
                        ) : null}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-line-strong" aria-hidden />
          Aula (cor da matéria)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-warn-soft ring-1 ring-warn" aria-hidden />
          Feriado ou sem aula
        </li>
        {(["pending", "overdue", "completed", "not_completed"] as const).map((tone) => (
          <li key={tone} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${TONE[tone].dot}`} aria-hidden />
            Tarefa {TONE[tone].label.toLowerCase()}
          </li>
        ))}
      </ul>

      <section className="grid gap-2" aria-labelledby="dia-escolhido" data-testid="dia-escolhido">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="dia-escolhido" className="text-sm font-semibold first-letter:uppercase">
            {dayLong(selected)}
          </h3>
          <ButtonLink
            href={`/tarefas/nova?data=${selected}&voltar=${encodeURIComponent(here)}`}
            variant="secondary"
          >
            <PlusIcon size={16} />
            Nova tarefa neste dia
          </ButtonLink>
        </div>
        {day && day.exceptions.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {day.exceptions.map((e) => (
              <li key={`${e.semesterLabel}-${e.label}`} className="font-medium text-warn">
                {EXCEPTION_LABEL[e.kind]}: {e.label}
                {e.subjectName ? ` (${e.subjectName})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {day && day.classes.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden" aria-label="Aulas do dia">
            {day.classes.map((c, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
                data-testid="aula-do-dia"
              >
                <span
                  className={`h-8 w-1 shrink-0 rounded-full ${c.color ? SUBJECT_COLOR_CLASS[c.color] : "bg-line-strong"}`}
                  aria-hidden
                />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">{c.subjectName}</span>
                  <span className="text-xs text-muted">
                    {c.startsAt}–{c.endsAt} · {c.units} {c.units === 1 ? "aula" : "aulas"}
                  </span>
                </span>
                {c.state === "upcoming" && selected > today ? (
                  <span className="text-xs text-muted">Próxima</span>
                ) : (
                  <Link
                    href={`/hoje?data=${selected}`}
                    className={`text-xs font-medium underline-offset-4 hover:underline ${c.state === "pending" ? "text-warn" : c.state === "done" ? "text-ok" : "text-accent"}`}
                  >
                    {c.state === "done"
                      ? "Chamada feita"
                      : c.state === "pending"
                        ? "Falta registrar a chamada"
                        : "Registrar a chamada"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {day && day.tasks.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {day.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhuma tarefa neste dia.</p>
        )}
      </section>
    </div>
  );
}
