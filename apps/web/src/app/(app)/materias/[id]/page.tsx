import { subjectSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { RiskBadge } from "@/components/subject-card";
import { EditSubjectForm } from "@/components/subject-form";
import { apiGet } from "@/lib/api-server";
import { plural } from "@/lib/format";
import { DeleteSubject, ScheduleManager } from "./subject-client";

export const metadata: Metadata = { title: "Matéria · Monitor de Presenças" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const subject = await apiGet(`/v1/subjects/${id}`, subjectSchema);
  const s = subject.summary;

  return (
    <>
      <header className="grid gap-1">
        <Link
          href={`/semestres/${subject.semesterId}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← Semestre
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{subject.name}</h1>
          <RiskBadge risk={s.risk} />
        </div>
        {subject.professor ? <p className="text-sm text-muted">{subject.professor}</p> : null}
      </header>

      <section
        className="rounded-2xl border border-line bg-surface p-6"
        aria-label="Resumo de faltas"
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Faltas" value={`${s.absentUnits} de ${s.maxAbsenceUnits}`} />
          <Stat
            label="Ainda pode faltar"
            value={
              s.exceededBy > 0
                ? `passou ${s.exceededBy}`
                : plural(s.remainingUnits, "tempo", "tempos")
            }
          />
          <Stat label="Limite usado" value={`${s.consumptionPct}%`} />
          <Stat
            label="Presença final (se for a todas)"
            value={
              s.projectedPresencePct === null
                ? "—"
                : `${s.projectedPresencePct.toLocaleString("pt-BR")}%`
            }
          />
        </dl>
      </section>

      <section
        className="grid gap-3 rounded-2xl border border-line bg-surface p-6"
        aria-labelledby="grade"
      >
        <h2 id="grade" className="font-semibold">
          Horários na semana
        </h2>
        <ScheduleManager
          subjectId={subject.id}
          schedules={subject.schedules}
          defaultUnits={subject.unitsPerClass}
        />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <EditSubjectForm key={subject.version} subject={subject} />
      </section>

      <DeleteSubject subject={subject} />
    </>
  );
}
