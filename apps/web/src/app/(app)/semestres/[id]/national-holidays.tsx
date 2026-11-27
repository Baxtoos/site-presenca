"use client";

import type { CalendarExceptionDto, Semester } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { addHolidays, missingHolidays } from "@/lib/holidays";

export function NationalHolidays({
  semester,
  exceptions,
}: {
  semester: Semester;
  exceptions: CalendarExceptionDto[];
}) {
  const router = useRouter();
  const missing = missingHolidays(semester, exceptions);
  const [unchecked, setUnchecked] = useState<Set<string>>(
    () => new Set(missing.filter((h) => h.optional).map((h) => h.startsOn)),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (missing.length === 0) return null;
  const selected = missing.filter((h) => !unchecked.has(h.startsOn));

  return (
    <section
      className="grid gap-3 rounded-xl border border-line p-4"
      aria-labelledby="feriados-nacionais"
    >
      <div className="grid gap-0.5">
        <h3 id="feriados-nacionais" className="text-sm font-semibold">
          Feriados nacionais neste semestre
        </h3>
        <p className="text-sm text-muted">
          Marque os que valem na sua faculdade. Estaduais, municipais e recessos você adiciona
          abaixo.
        </p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="grid gap-1.5">
        {missing.map((h) => (
          <li key={h.startsOn}>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={!unchecked.has(h.startsOn)}
                onChange={(e) =>
                  setUnchecked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(h.startsOn);
                    else next.add(h.startsOn);
                    return next;
                  })
                }
              />
              <span>
                <span className="font-medium">{h.label}</span>
                <span className="text-muted">
                  {" "}
                  · {formatDate(h.startsOn)}
                  {h.endsOn !== h.startsOn ? ` a ${formatDate(h.endsOn)}` : ""}
                  {h.optional ? " · ponto facultativo" : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        className="sm:w-fit"
        loading={pending}
        disabled={selected.length === 0}
        onClick={() => {
          setPending(true);
          setError(undefined);
          addHolidays(semester.id, selected)
            .then(() => router.refresh())
            .catch((e: unknown) =>
              setError(e instanceof ApiError ? e.message : "Não foi possível adicionar."),
            )
            .finally(() => setPending(false));
        }}
      >
        {selected.length === 1 ? "Adicionar 1 feriado" : `Adicionar ${selected.length} feriados`}
      </Button>
    </section>
  );
}
