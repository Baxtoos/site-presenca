import {
  attendanceListSchema,
  type SimulateResponse,
  simulateResponseSchema,
  subjectCalendarSchema,
  subjectEvolutionSchema,
  subjectGradingSchema,
  subjectSchema,
} from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceHistory, ExtraClassForm } from "@/components/attendance/history";
import { SubjectCalendar } from "@/components/attendance/subject-calendar";
import { EvolutionCharts } from "@/components/charts/evolution-charts";
import { GradeBadge } from "@/components/grades/grade-badge";
import { GradesPanel } from "@/components/grades/grades-panel";
import { BookIcon, ChevronRightIcon, SettingsIcon } from "@/components/icons";
import { RiskLine } from "@/components/subject-card";
import { ButtonLink, PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import {
  formatDayLabel,
  plural,
  RISK_LABEL,
  simulateHint,
  SUBJECT_COLOR_CLASS,
} from "@/lib/format";

export const metadata: Metadata = { title: "Matéria · Monitor de Presenças" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** "Posso faltar a próxima aula?": o simulador da API, que já desconta feriados e o que foi registrado. */
function CanISkip({ sim }: { sim: SimulateResponse }) {
  const next = sim.ifSkipNext;
  return (
    <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="posso-faltar">
      <h2 id="posso-faltar" className="text-lg font-semibold tracking-tight">
        Posso faltar?
      </h2>
      {sim.nextClass && next ? (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${next.allowed ? "bg-ok-soft" : "bg-fail-soft"}`}
        >
          {next.allowed ? (
            <>
              <strong className="text-ok">Sim.</strong> Faltando a próxima aula (
              {formatDayLabel(sim.nextClass.date)}, {plural(sim.nextClass.units, "aula", "aulas")}
              ), você fica com {plural(next.remainingUnits, "aula", "aulas")} de folga
              {next.risk !== "safe" ? ` e entra em "${RISK_LABEL[next.risk]}"` : ""}.
            </>
          ) : (
            <>
              <strong className="text-fail">Não.</strong> Faltar a próxima aula (
              {formatDayLabel(sim.nextClass.date)}) passa do limite de faltas.
            </>
          )}
        </p>
      ) : null}
      <p className="text-sm text-muted">{simulateHint(sim)}</p>
      {sim.plan.firstUnsafe ? (
        <p className="text-sm text-muted">
          A primeira falta que reprova seria em {formatDayLabel(sim.plan.firstUnsafe.date)}.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {plural(sim.upcomingClasses, "aula restante", "aulas restantes")} na grade, já sem feriados.
      </p>
    </section>
  );
}

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [subject, calendar, sim, history, grading, evolution] = await Promise.all([
    apiGet(`/v1/subjects/${id}`, subjectSchema),
    apiGet(`/v1/subjects/${id}/calendar`, subjectCalendarSchema),
    apiGet(`/v1/subjects/${id}/simulate`, simulateResponseSchema),
    apiGet(`/v1/subjects/${id}/attendance?limit=30`, attendanceListSchema),
    apiGet(`/v1/subjects/${id}/grading`, subjectGradingSchema),
    // Sem o gráfico (ex.: API antiga durante o deploy), a página continua.
    apiGet(`/v1/subjects/${id}/evolution`, subjectEvolutionSchema).catch(() => null),
  ]);
  const s = subject.summary;

  return (
    <>
      <PageHeader
        back={{ href: `/semestres/${subject.semesterId}`, label: "← Semestre" }}
        iconTile={false}
        icon={
          <span
            className={`grid size-12 place-items-center rounded-xl text-white shadow-sm ${subject.color ? SUBJECT_COLOR_CLASS[subject.color] : "bg-muted"}`}
          >
            <BookIcon size={26} />
          </span>
        }
        title={subject.name}
        description={subject.professor ?? undefined}
        actions={
          <ButtonLink href={`/materias/${subject.id}/editar`} variant="secondary">
            <SettingsIcon size={16} />
            Editar matéria
          </ButtonLink>
        }
      >
        <RiskLine summary={s} unitsPerClass={subject.unitsPerClass} className="text-[15px]" />
        {grading.summary ? <GradeBadge status={grading.summary.status} /> : null}
      </PageHeader>

      <section className="card p-5 sm:p-6" aria-label="Resumo de faltas">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Faltas" value={`${s.absentUnits} de ${s.maxAbsenceUnits}`} />
          <Stat
            label="Ainda pode faltar"
            value={
              s.exceededBy > 0
                ? `passou ${s.exceededBy}`
                : plural(s.remainingUnits, "aula", "aulas")
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

      <section className="grid gap-3 card p-4 sm:p-6" aria-labelledby="calendario">
        <h2 id="calendario" className="text-lg font-semibold tracking-tight">
          Calendário de presença
        </h2>
        {subject.schedules.length === 0 && calendar.days.length === 0 ? (
          <p className="text-sm text-muted">
            Cadastre os horários da matéria em{" "}
            <Link href={`/materias/${subject.id}/editar`} className="text-accent hover:underline">
              Editar matéria
            </Link>{" "}
            para os dias de aula aparecerem aqui.
          </p>
        ) : null}
        <SubjectCalendar key={calendar.month} subjectId={subject.id} initial={calendar} />
      </section>

      <CanISkip sim={sim} />

      <GradesPanel key={grading.scheme?.version ?? 0} initial={grading} />

      {evolution ? (
        <section className="grid gap-4 card p-5 sm:p-6" aria-labelledby="evolucao">
          <h2 id="evolucao" className="text-lg font-semibold tracking-tight">
            Evolução no semestre
          </h2>
          <EvolutionCharts data={evolution} />
        </section>
      ) : null}

      <details className="group card p-5 sm:p-6">
        <summary className="cursor-pointer list-none font-semibold marker:hidden">
          <ChevronRightIcon
            size={16}
            className="inline-block align-[-3px] transition-transform group-open:rotate-90"
          />{" "}
          Histórico e aula extra
        </summary>
        <div className="mt-4 grid gap-4">
          <AttendanceHistory subjectId={subject.id} initial={history} />
          <ExtraClassForm
            subjectId={subject.id}
            defaultUnits={subject.unitsPerClass}
            today={sim.asOf}
          />
        </div>
      </details>
    </>
  );
}
