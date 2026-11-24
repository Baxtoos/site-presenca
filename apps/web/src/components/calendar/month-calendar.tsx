"use client";

import type { CalendarDay } from "@presenca/contracts";
import type { MonthGrid } from "@presenca/engine";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui";
import { dayLong, EXCEPTION_LABEL, monthLong, TONE, taskTone } from "@/lib/calendar";
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

/**
 * Calendário mensal (segunda a domingo). No computador, cada dia mostra as tarefas como etiquetas;
 * no celular, bolinhas coloridas. Escolher um dia mostra a lista dele logo abaixo, com as ações e o
 * atalho para criar uma tarefa já com aquela data.
 */
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
  const [extras, setExtras] = useState(false);
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
            checked={extras}
            onChange={(e) => setExtras(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          Mostrar exceções e chamadas pendentes
        </label>
      </div>

      <table className="w-full table-fixed border-collapse text-sm" data-testid="calendario-mes">
        <caption className="sr-only">
          Calendário de {monthLong(grid.month)}. Escolha um dia para ver as tarefas.
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
                const isSelected = date === selected;
                const isToday = date === today;
                const label = [
                  dayLong(date),
                  tasks.length > 0
                    ? `${tasks.length} ${tasks.length === 1 ? "tarefa" : "tarefas"}`
                    : null,
                  tasks.some((t) => taskTone(t) === "overdue") ? "com atrasada" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <td key={date} className="border border-line p-0 align-top">
                    <button
                      type="button"
                      onClick={() => setSelected(date)}
                      aria-pressed={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      data-date={date}
                      className={`flex h-14 w-full flex-col items-stretch gap-0.5 p-1 text-left transition-colors sm:h-28 ${isSelected ? "bg-accent-soft" : "hover:bg-surface-2"} ${inMonth(date) ? "" : "bg-surface-2/50 text-muted"}`}
                    >
                      <span
                        className={`grid size-6 place-items-center self-center rounded-full text-xs tabular-nums sm:self-start ${isToday ? "bg-accent font-semibold text-accent-ink" : ""}`}
                      >
                        {Number(date.slice(8))}
                      </span>
                      {/* Nome para leitores de tela (o número visível vem antes, como pede a WCAG 2.5.3). */}
                      <span className="sr-only">, {label}</span>
                      {/* Celular: bolinhas. */}
                      <span className="flex flex-wrap justify-center gap-0.5 sm:hidden" aria-hidden>
                        {tasks.slice(0, 4).map((t) => (
                          <span
                            key={t.id}
                            className={`size-1.5 rounded-full ${TONE[taskTone(t)].dot}`}
                          />
                        ))}
                        {extras && (info?.pendingClasses ?? 0) > 0 ? (
                          <span className="size-1.5 rounded-full bg-warn" />
                        ) : null}
                      </span>
                      {/* Computador: etiquetas. */}
                      <span className="hidden min-w-0 gap-0.5 sm:grid" aria-hidden>
                        {extras
                          ? info?.exceptions.slice(0, 1).map((e) => (
                              <span key={e.label} className="truncate text-[11px] text-warn">
                                {e.label}
                              </span>
                            ))
                          : null}
                        {extras && (info?.pendingClasses ?? 0) > 0 ? (
                          <span className="truncate text-[11px] text-warn">
                            {info!.pendingClasses} sem chamada
                          </span>
                        ) : null}
                        {tasks.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className={`truncate rounded border px-1 text-[11px] leading-4 ${TONE[taskTone(t)].chip}`}
                          >
                            {t.title}
                          </span>
                        ))}
                        {tasks.length > 3 ? (
                          <span className="text-[11px] text-muted">+{tasks.length - 3}</span>
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
        {(["pending", "overdue", "completed", "not_completed"] as const).map((tone) => (
          <li key={tone} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${TONE[tone].dot}`} aria-hidden />
            {TONE[tone].label}
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
        {day && (day.exceptions.length > 0 || day.pendingClasses > 0) ? (
          <ul className="grid gap-1 text-sm">
            {day.exceptions.map((e) => (
              <li key={`${e.semesterLabel}-${e.label}`} className="text-warn">
                {EXCEPTION_LABEL[e.kind]}: {e.label}
                {e.subjectName ? ` (${e.subjectName})` : ""}
              </li>
            ))}
            {day.pendingClasses > 0 ? (
              <li>
                <Link
                  href={`/hoje?data=${selected}`}
                  className="font-medium text-warn underline-offset-4 hover:underline"
                >
                  {day.pendingClasses === 1
                    ? "1 aula sem chamada registrada"
                    : `${day.pendingClasses} aulas sem chamada registrada`}
                </Link>
              </li>
            ) : null}
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
