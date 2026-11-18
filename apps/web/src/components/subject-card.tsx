import type { Subject } from "@presenca/contracts";
import Link from "next/link";
import { plural, RISK_LABEL, RISK_STYLE, SUBJECT_COLOR_CLASS, WEEKDAYS_SHORT } from "@/lib/format";

export function RiskBadge({ risk }: { risk: Subject["summary"]["risk"] }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_STYLE[risk].badge}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {RISK_LABEL[risk]}
    </span>
  );
}

/** Card da matéria: o semáforo, quanto já faltou e quanto ainda pode faltar. */
export function SubjectCard({ subject }: { subject: Subject }) {
  const s = subject.summary;
  const width = Math.min(100, s.consumptionPct);
  const days = [...new Set(subject.schedules.map((x) => x.weekday))]
    .sort()
    .map((d) => WEEKDAYS_SHORT[d])
    .join(" · ");

  return (
    <Link
      href={`/materias/${subject.id}`}
      className="group relative grid gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-5 pl-6 transition-colors hover:border-accent/50"
    >
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${subject.color ? SUBJECT_COLOR_CLASS[subject.color] : "bg-line"}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="truncate font-semibold group-hover:text-accent">{subject.name}</h3>
          <p className="truncate text-xs text-muted">
            {[subject.professor, days || "sem horário na grade"].filter(Boolean).join(" · ")}
          </p>
        </div>
        <RiskBadge risk={s.risk} />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <strong className="text-lg tabular-nums">{s.absentUnits}</strong>
            <span className="text-muted"> de {s.maxAbsenceUnits} faltas</span>
          </span>
          <span className="text-xs tabular-nums text-muted">{s.consumptionPct}% do limite</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={s.consumptionPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${s.consumptionPct}% do limite de faltas usado`}
        >
          <div
            className={`h-full rounded-full ${RISK_STYLE[s.risk].bar}`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>

      <p className="text-sm">
        {s.exceededBy > 0 ? (
          <span className="font-medium text-fail">
            Passou do limite em {plural(s.exceededBy, "tempo", "tempos")}.
          </span>
        ) : (
          <>
            Ainda pode faltar <strong>{plural(s.remainingUnits, "tempo", "tempos")}</strong>
            {subject.unitsPerClass > 1 ? (
              <span className="text-muted">
                {" "}
                ({plural(s.remainingClasses, "encontro", "encontros")})
              </span>
            ) : null}
            .
          </>
        )}
      </p>
    </Link>
  );
}
