import {
  calendarResponseSchema,
  meResponseSchema,
  type CalendarResponse,
} from "@presenca/contracts";
import { monthGrid, shiftMonth } from "@presenca/engine";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { Timeline } from "@/components/calendar/timeline";
import { UrlSelect } from "@/components/calendar/url-select";
import { CalendarIcon, PlusIcon } from "@/components/icons";
import { Alert, ButtonLink, PageHeader, SectionTitle } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import {
  TIMELINE_STATUS,
  TIMELINE_WINDOWS,
  type TimelineStatus,
  type TimelineWindow,
  todayIn,
  windowRange,
} from "@/lib/calendar";
import { currentSubjects } from "../tarefas/subjects";

export const metadata: Metadata = { title: "Calendário · Monitor de Presenças" };

type Params = Record<
  "janela" | "status" | "mes" | "materia" | "situacao",
  string | string[] | undefined
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const CALENDAR_STATUS = [
  { value: "", label: "Todos", status: undefined },
  { value: "pendentes", label: "Pendentes", status: "pending" },
  { value: "concluidas", label: "Concluídas", status: "completed" },
  { value: "nao-concluidas", label: "Não concluídas", status: "not_completed" },
] as const;

const pillClass = (active: boolean) =>
  `inline-flex min-h-9 items-center rounded-md border px-3 text-sm transition-colors ${active ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong bg-surface text-muted hover:bg-surface-2"}`;

/**
 * Painel de pendências: linha do tempo (o que vence, o que atrasou, o que foi feito) e calendário
 * mensal com as tarefas, as exceções do semestre e as chamadas que ficaram sem registro. Todos os
 * filtros ficam na URL (Voltar e recarregar mantêm a tela).
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const me = await apiGet("/v1/me", meResponseSchema);
  const today = todayIn(me.timezone);

  const window: TimelineWindow =
    TIMELINE_WINDOWS.find((w) => w.id === one(params.janela))?.id ?? "7";
  // "Atrasadas" são sempre pendentes.
  const statusId: TimelineStatus =
    window === "atrasadas"
      ? "pendentes"
      : (TIMELINE_STATUS.find((s) => s.id === one(params.status))?.id ?? "pendentes");
  const timelineStatus = TIMELINE_STATUS.find((s) => s.id === statusId)!.status;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(one(params.mes) ?? "")
    ? one(params.mes)!
    : today.slice(0, 7);
  const grid = monthGrid(month);
  const materia = UUID.test(one(params.materia) ?? "") ? one(params.materia) : undefined;
  const situacao =
    CALENDAR_STATUS.find((s) => s.value === (one(params.situacao) ?? "")) ?? CALENDAR_STATUS[0];

  const query = (
    from: string,
    to: string,
    extra: Record<string, string | undefined>,
  ): `/v1/${string}` => {
    const q = new URLSearchParams({ from, to });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `/v1/calendar?${q}`;
  };
  const range = windowRange(window, today);
  const [timeline, calendar, subjects] = await Promise.all([
    apiGet(query(range.from, range.to, { status: timelineStatus }), calendarResponseSchema),
    apiGet(
      query(grid.gridFrom, grid.gridTo, {
        subjectId: materia,
        status: situacao.status,
        classes: "true",
      }),
      calendarResponseSchema,
    ),
    currentSubjects(),
  ]);

  const timelineTasks = tasksOf(timeline).filter((t) => window !== "atrasadas" || t.overdue);
  const href = (overrides: Partial<Record<keyof Params, string | null>>) => {
    const next = new URLSearchParams();
    for (const key of ["janela", "status", "mes", "materia", "situacao"] as const) {
      const value = key in overrides ? overrides[key] : one(params[key]);
      if (value) next.set(key, value);
    }
    const q = next.toString();
    return q ? `/calendario?${q}` : "/calendario";
  };
  const emptyText =
    window === "atrasadas"
      ? "Nenhuma tarefa atrasada. Tudo em dia!"
      : statusId === "pendentes"
        ? "Nenhuma tarefa pendente nesta janela."
        : "Nenhuma tarefa nesta janela.";

  return (
    <>
      <PageHeader
        icon={<CalendarIcon size={26} />}
        title="Calendário"
        description="Suas entregas no tempo: o que vence, o que atrasou e o que já foi feito, com as semanas de prova e os feriados do semestre."
        actions={
          <>
            <ButtonLink href="/conta/moodle" variant="ghost">
              Moodle
            </ButtonLink>
            <ButtonLink href="/tarefas" variant="ghost">
              Ver em lista
            </ButtonLink>
            <ButtonLink href={`/tarefas/nova?voltar=${encodeURIComponent(href({}))}`}>
              <PlusIcon size={16} />
              Nova tarefa
            </ButtonLink>
          </>
        }
      />

      <section className="grid gap-3" aria-labelledby="linha-do-tempo">
        <SectionTitle id="linha-do-tempo">Linha do tempo</SectionTitle>
        <nav aria-label="Período" className="flex flex-wrap gap-1.5">
          {TIMELINE_WINDOWS.map((w) => (
            <Link
              key={w.id}
              href={href({ janela: w.id === "7" ? null : w.id })}
              scroll={false}
              aria-current={window === w.id ? "page" : undefined}
              className={pillClass(window === w.id)}
            >
              {w.label}
            </Link>
          ))}
        </nav>
        {window !== "atrasadas" ? (
          <nav aria-label="Status" className="flex flex-wrap gap-1.5">
            {TIMELINE_STATUS.map((s) => (
              <Link
                key={s.id}
                href={href({ status: s.id === "pendentes" ? null : s.id })}
                scroll={false}
                aria-current={statusId === s.id ? "page" : undefined}
                className={pillClass(statusId === s.id)}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        ) : null}
        {window !== "atrasadas" && timeline.overdueCount > 0 ? (
          <Alert tone="info">
            {timeline.overdueCount === 1
              ? "1 tarefa passou do prazo e falta você contar se entregou. "
              : `${timeline.overdueCount} tarefas passaram do prazo e falta você contar se entregou. `}
            <Link
              href={href({ janela: "atrasadas", status: null })}
              className="font-medium underline"
            >
              Ver atrasadas
            </Link>
          </Alert>
        ) : null}
        <Timeline tasks={timelineTasks} emptyText={emptyText} />
      </section>

      <section className="grid gap-3" aria-labelledby="calendario-mensal">
        <SectionTitle id="calendario-mensal">Calendário do mês</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {subjects.length > 0 ? (
            <UrlSelect
              id="calendario-materia"
              label="Matéria"
              param="materia"
              options={[
                { value: "", label: "Todas as matérias" },
                ...subjects.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          ) : null}
          <UrlSelect
            id="calendario-status"
            label="Status das tarefas"
            param="situacao"
            options={CALENDAR_STATUS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>
        <MonthCalendar
          key={month}
          grid={grid}
          days={calendar.days}
          today={today}
          prevHref={href({ mes: shiftMonth(month, -1) })}
          nextHref={href({ mes: shiftMonth(month, 1) })}
          todayHref={href({ mes: null })}
        />
      </section>
    </>
  );
}

const tasksOf = (r: CalendarResponse) => r.days.flatMap((d) => d.tasks);
