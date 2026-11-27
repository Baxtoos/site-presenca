"use client";

import type { SubjectEvolution } from "@presenca/contracts";
import { formatGrade } from "@presenca/engine";
import { StepChart } from "./step-chart";

export function EvolutionCharts({ data }: { data: SubjectEvolution }) {
  const { semester, today, absences, grades } = data;
  const lastAbsence = absences.points.at(-1)?.total ?? 0;
  const gradePoints = grades?.points ?? [];
  if (absences.points.length === 0 && gradePoints.length === 0) {
    return (
      <p className="text-sm text-muted">
        Ainda não há faltas nem notas para mostrar. O gráfico aparece conforme você registra o
        semestre.
      </p>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <StepChart
        title="Faltas que contam no limite"
        start={semester.startsOn}
        end={semester.endsOn}
        today={today}
        yMax={Math.max(lastAbsence, absences.limit)}
        reference={{ label: `Limite: ${absences.limit} faltas`, value: absences.limit }}
        series={[
          {
            name: "Faltas",
            color: "var(--color-accent)",
            points: [
              { date: semester.startsOn, value: 0 },
              ...absences.points.map((p) => ({ date: p.date, value: p.total })),
            ],
          },
        ]}
        format={(v) => String(Math.round(v))}
      />
      {grades && gradePoints.length > 0 ? (
        <StepChart
          title="Nota ao longo do semestre"
          start={semester.startsOn}
          end={semester.endsOn}
          today={today}
          yMax={grades.scale * 100}
          reference={{ label: `Passa com ${formatGrade(grades.passing)}`, value: grades.passing }}
          series={[
            {
              name: "Nota garantida",
              color: "var(--color-accent)",
              points: [
                { date: semester.startsOn, value: 0 },
                ...gradePoints.map((p) => ({ date: p.date, value: p.guaranteed })),
              ],
            },
            {
              name: "Média parcial",
              color: "var(--color-chart-2)",
              dashed: true,
              points: gradePoints.flatMap((p) =>
                p.partial === null ? [] : [{ date: p.date, value: p.partial }],
              ),
            },
          ]}
          format={(v) => formatGrade(Math.round(v))}
        />
      ) : (
        <p className="self-center text-sm text-muted">
          A nota aparece aqui quando a matéria tiver a regra de cálculo e a primeira nota lançada.
        </p>
      )}
    </div>
  );
}
