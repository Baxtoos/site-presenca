import type { CalendarExceptionDto } from "@presenca/contracts";
import { brazilHolidaysBetween, type Holiday } from "@presenca/engine";
import { api } from "@/lib/api-client";

/** Feriados nacionais do período que ainda não estão cadastrados (mesma data de início). */
export function missingHolidays(
  range: { startsOn: string; endsOn: string },
  exceptions: Pick<CalendarExceptionDto, "startsOn" | "subjectId">[],
): Holiday[] {
  const taken = new Set(exceptions.filter((e) => e.subjectId === null).map((e) => e.startsOn));
  return (
    brazilHolidaysBetween(range.startsOn, range.endsOn)
      // Feriado que cai só em parte no semestre (Carnaval na semana de início): só os dias de
      // dentro, senão a API recusa por estar fora do semestre.
      .map((h) => ({
        ...h,
        startsOn: h.startsOn < range.startsOn ? range.startsOn : h.startsOn,
        endsOn: h.endsOn > range.endsOn ? range.endsOn : h.endsOn,
      }))
      .filter((h) => !taken.has(h.startsOn))
  );
}

/** Cadastra os feriados como dias sem aula para todas as matérias do semestre. */
export async function addHolidays(semesterId: string, holidays: Holiday[]): Promise<void> {
  for (const h of holidays) {
    await api(`/v1/semesters/${semesterId}/exceptions`, {
      method: "POST",
      body: {
        label: h.label,
        startsOn: h.startsOn,
        endsOn: h.endsOn,
        kind: "holiday",
        subjectId: null,
      },
    });
  }
}
