import { todayResponseSchema } from "@presenca/contracts";
import { addDays } from "@presenca/engine";
import type { Metadata } from "next";
import Link from "next/link";
import { TodayPanel } from "@/components/attendance/today-panel";
import { UpcomingTasks } from "@/components/tasks/upcoming-tasks";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, TodayIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { formatDate, WEEKDAYS } from "@/lib/format";

export const metadata: Metadata = { title: "Aulas do dia · Monitor de Presenças" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const navClass =
  "inline-flex min-h-11 items-center gap-1 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-surface-2 sm:min-h-10";

/** Aulas de um dia (hoje por padrão). Dá para voltar dias para marcar o que esqueceu. */
export default async function DayPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string | string[] }>;
}) {
  const { data: raw } = await searchParams;
  const requested = typeof raw === "string" && ISO.test(raw) ? raw : undefined;
  const day = await apiGet(
    `/v1/today${requested ? `?date=${requested}` : ""}`,
    todayResponseSchema,
  );
  const prev = addDays(day.date, -1);
  const next = addDays(day.date, 1);

  return (
    <>
      <PageHeader
        icon={day.isToday ? <TodayIcon size={26} /> : <ClockIcon size={26} />}
        eyebrow={day.isToday ? "Hoje" : "Registrar dia passado"}
        title={`${WEEKDAYS[day.weekday]}, ${formatDate(day.date)}`}
        description="Marque cada aula com um toque. Dá para voltar dias para registrar o que esqueceu."
      />

      <nav className="flex flex-wrap items-center gap-2" aria-label="Escolher dia">
        <Link href={`/hoje?data=${prev}`} className={navClass}>
          <ChevronLeftIcon size={16} />
          Dia anterior
        </Link>
        {day.isToday ? null : (
          <>
            <Link href={`/hoje?data=${next}`} className={navClass}>
              Próximo dia
              <ChevronRightIcon size={16} />
            </Link>
            <Link
              href="/hoje"
              className="rounded-md px-2 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
            >
              Voltar para hoje
            </Link>
          </>
        )}
      </nav>

      {day.exceptions.length > 0 && day.classes.length > 0 ? (
        <p className="rounded-lg bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          {day.exceptions.map((e) => e.label).join(" · ")}
        </p>
      ) : null}

      <TodayPanel data={day} />

      {day.isToday ? <UpcomingTasks days={2} title="Entregas próximas" /> : null}
    </>
  );
}
