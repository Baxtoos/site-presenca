import { todayResponseSchema } from "@presenca/contracts";
import { addDays } from "@presenca/engine";
import type { Metadata } from "next";
import Link from "next/link";
import { TodayPanel } from "@/components/attendance/today-panel";
import { apiGet } from "@/lib/api-server";
import { formatDate, WEEKDAYS } from "@/lib/format";

export const metadata: Metadata = { title: "Aulas do dia · Monitor de Presenças" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const navClass =
  "inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2";

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
      <header className="grid gap-1">
        <p className="text-sm text-muted">{day.isToday ? "Hoje" : "Registrar dia passado"}</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {WEEKDAYS[day.weekday]}, {formatDate(day.date)}
        </h1>
      </header>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Escolher dia">
        <Link href={`/hoje?data=${prev}`} className={navClass}>
          ← Dia anterior
        </Link>
        {day.isToday ? null : (
          <>
            <Link href={`/hoje?data=${next}`} className={navClass}>
              Próximo dia →
            </Link>
            <Link href="/hoje" className="text-sm font-medium text-accent hover:underline">
              Voltar para hoje
            </Link>
          </>
        )}
      </nav>

      {day.exceptions.length > 0 && day.classes.length > 0 ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {day.exceptions.map((e) => e.label).join(" · ")}
        </p>
      ) : null}

      <TodayPanel data={day} />
    </>
  );
}
