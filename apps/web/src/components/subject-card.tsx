import type { Subject } from "@presenca/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertIcon } from "@/components/icons";
import { plural, RISK_STYLE, SUBJECT_COLOR_CLASS, WEEKDAYS_SHORT } from "@/lib/format";

type Summary = Subject["summary"];

const RISK_TEXT: Record<Summary["risk"], string> = {
  safe: "",
  warning: "text-warn",
  critical: "font-medium text-crit",
  limit: "font-medium text-fail",
  failed: "font-medium text-fail",
};

/**
 * O aviso de risco em forma de frase (no lugar do antigo selo "Seguro/Atenção/..."): só ganha cor
 * e ícone quando importa. `short` é a versão curta da tela Hoje.
 */
export function RiskLine({
  summary: s,
  unitsPerClass,
  short = false,
  className = "",
}: {
  summary: Summary;
  unitsPerClass: number;
  short?: boolean;
  className?: string;
}) {
  const left = plural(s.remainingUnits, "tempo", "tempos");
  const meetings =
    !short && unitsPerClass > 1 ? ` (${plural(s.remainingClasses, "encontro", "encontros")})` : "";
  let content: ReactNode;
  if (s.risk === "failed" || s.exceededBy > 0) {
    content = `Reprovado por falta: passou do limite em ${plural(s.exceededBy, "tempo", "tempos")}.`;
  } else if (s.risk === "limit") {
    content = "Limite atingido: mais uma falta reprova.";
  } else if (s.risk === "critical") {
    content = `Cuidado: só pode faltar mais ${left}${meetings}.`;
  } else if (s.risk === "warning") {
    content = `Atenção: ainda pode faltar ${left}${meetings}.`;
  } else {
    content = (
      <>
        Ainda pode faltar <strong>{left}</strong>
        {meetings ? <span className="text-muted">{meetings}</span> : null}.
      </>
    );
  }
  const risky = s.risk !== "safe" || s.exceededBy > 0;
  return (
    <p
      className={`flex items-start gap-1.5 ${RISK_TEXT[s.exceededBy > 0 ? "failed" : s.risk]} ${className}`}
      data-risk={s.risk}
    >
      {risky ? <AlertIcon size={short ? 14 : 16} className="mt-0.5 shrink-0" /> : null}
      <span>{content}</span>
    </p>
  );
}

/** Card da matéria: quanto já faltou, a barra do limite e quanto ainda pode faltar. */
export function SubjectCard({ subject, hint }: { subject: Subject; hint?: string }) {
  const s = subject.summary;
  const width = Math.min(100, s.consumptionPct);
  const days = [...new Set(subject.schedules.map((x) => x.weekday))]
    .sort()
    .map((d) => WEEKDAYS_SHORT[d])
    .join(" · ");

  return (
    <Link
      href={`/materias/${subject.id}`}
      className="group card relative grid gap-3 overflow-hidden p-4 pt-5 transition-[background-color,box-shadow] hover:bg-surface-2/60 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        className={`absolute inset-x-0 top-0 h-1.5 ${subject.color ? SUBJECT_COLOR_CLASS[subject.color] : "bg-line-strong"}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="truncate font-semibold">{subject.name}</h3>
          <p className="truncate text-xs text-muted">
            {[subject.professor, days || "sem horário na grade"].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <strong className="text-xl font-semibold tabular-nums">{s.absentUnits}</strong>
            <span className="text-muted"> de {s.maxAbsenceUnits} faltas</span>
          </span>
          <span className="text-xs tabular-nums text-muted">{s.consumptionPct}% do limite</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-2"
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

      <RiskLine summary={s} unitsPerClass={subject.unitsPerClass} className="text-sm" />
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </Link>
  );
}
