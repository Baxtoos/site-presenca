import {
  attendanceListSchema,
  type SimulateResponse,
  simulateResponseSchema,
  subjectSchema,
} from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceHistory, ExtraClassForm } from "@/components/attendance/history";
import { RiskBadge } from "@/components/subject-card";
import { EditSubjectForm } from "@/components/subject-form";
import { SharePanel } from "@/components/sharing/share-panel";
import { apiGet, getMe } from "@/lib/api-server";
import { formatDayLabel, plural, RISK_LABEL, simulateHint } from "@/lib/format";
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

/** "Posso faltar a próxima aula?": o simulador da API, que já desconta feriados e o que foi registrado. */
function CanISkip({ sim }: { sim: SimulateResponse }) {
  const next = sim.ifSkipNext;
  return (
    <section
      className="grid gap-3 rounded-2xl border border-line bg-surface p-6"
      aria-labelledby="posso-faltar"
    >
      <h2 id="posso-faltar" className="font-semibold">
        Posso faltar?
      </h2>
      {sim.nextClass && next ? (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${next.allowed ? "bg-ok-soft" : "bg-fail-soft"}`}
        >
          {next.allowed ? (
            <>
              <strong className="text-ok">Sim.</strong> Faltando a próxima aula (
              {formatDayLabel(sim.nextClass.date)}, {plural(sim.nextClass.units, "tempo", "tempos")}
              ), você fica com {plural(next.remainingUnits, "tempo", "tempos")} de folga
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
  const [me, subject, sim, history] = await Promise.all([
    getMe(),
    apiGet(`/v1/subjects/${id}`, subjectSchema),
    apiGet(`/v1/subjects/${id}/simulate`, simulateResponseSchema),
    apiGet(`/v1/subjects/${id}/attendance?limit=30`, attendanceListSchema),
  ]);
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

      <CanISkip sim={sim} />

      <section
        className="grid gap-4 rounded-2xl border border-line bg-surface p-6"
        aria-labelledby="historico"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="historico" className="font-semibold">
            Histórico de chamadas
          </h2>
          <Link href="/hoje" className="text-sm font-medium text-accent hover:underline">
            Marcar um dia da grade
          </Link>
        </div>
        <AttendanceHistory subjectId={subject.id} initial={history} />
        <ExtraClassForm
          subjectId={subject.id}
          defaultUnits={subject.unitsPerClass}
          today={sim.asOf}
        />
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

      <section
        className="grid gap-3 rounded-2xl border border-line bg-surface p-6"
        aria-labelledby="compartilhar"
      >
        <div className="grid gap-1">
          <h2 id="compartilhar" className="font-semibold">
            Compartilhar esta matéria
          </h2>
          <p className="text-sm text-muted">
            Útil para quem só faz esta matéria com você. Suas faltas não vão junto.
          </p>
        </div>
        <SharePanel
          source={{ kind: "subject", subjectId: subject.id }}
          defaultTitle={subject.name}
          emailVerified={me?.emailVerified ?? false}
        />
      </section>

      <DeleteSubject subject={subject} />
    </>
  );
}
