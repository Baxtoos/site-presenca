import { GRADE_STATUS_LABEL, subjectGradingSchema } from "@presenca/contracts";
import { formatGrade } from "@presenca/engine";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, GradeIcon } from "@/components/icons";
import { ButtonLink, PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { GRADE_STATUS_STYLE } from "@/lib/grades";
import { currentSubjects } from "../tarefas/subjects";

export const metadata: Metadata = { title: "Notas · Monitor de Presenças" };

/** Notas de todas as matérias do semestre atual: situação, média e quanto falta (contas do motor). */
export default async function GradesPage() {
  const subjects = await currentSubjects();
  // shortcut: uma chamada por matéria (um semestre tem poucas); se ficar lento, criar GET /v1/grades.
  const gradings = await Promise.all(
    subjects.map((s) => apiGet(`/v1/subjects/${s.id}/grading`, subjectGradingSchema)),
  );

  return (
    <>
      <PageHeader
        icon={<GradeIcon size={26} />}
        title="Notas"
        description="A situação de cada matéria: média, nota garantida e quanto falta para passar. Toque numa matéria para lançar notas ou simular."
      />
      {subjects.length === 0 ? (
        <section className="card grid gap-3 p-6 text-sm">
          <p className="text-muted">Cadastre o semestre e as matérias para acompanhar as notas.</p>
          <ButtonLink href="/semestres" variant="secondary" className="w-fit">
            Ir para Semestres
          </ButtonLink>
        </section>
      ) : (
        <ul className="grid gap-3" aria-label="Matérias">
          {subjects.map((s, i) => {
            const g = gradings[i]!;
            const summary = g.scheme ? g.summary : null;
            const scored = g.items.filter((it) => it.score !== null).length;
            return (
              <li key={s.id}>
                <Link
                  href={`/materias/${s.id}#notas`}
                  className="card grid gap-2 p-4 transition-colors hover:bg-surface-2 sm:p-5"
                  data-testid="nota-materia"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 font-semibold">{s.name}</span>
                    {summary ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${GRADE_STATUS_STYLE[summary.status]}`}
                      >
                        {GRADE_STATUS_LABEL[summary.status]}
                      </span>
                    ) : null}
                    <ChevronRightIcon size={18} className="text-muted" />
                  </span>
                  {summary && g.scheme ? (
                    <span className="grid gap-1 text-sm text-muted">
                      <span>
                        {summary.final !== null ? "Média final" : "Nota garantida"}{" "}
                        <strong className="text-ink tabular-nums">
                          {formatGrade(summary.final ?? summary.guaranteed)}
                        </strong>
                        {summary.partial !== null ? (
                          <>
                            {" · média parcial "}
                            <strong className="text-ink tabular-nums">
                              {formatGrade(summary.partial)}
                            </strong>
                          </>
                        ) : null}
                        {` · passa com ${formatGrade(g.scheme.rules.passing)} · ${scored} de ${g.items.length} notas lançadas`}
                      </span>
                      {summary.needed ? (
                        <span>
                          Para passar:{" "}
                          {summary.needed.items
                            .map((it) => `${formatGrade(it.needed)} na ${it.name}`)
                            .join(", ")}
                          .
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-sm text-muted">
                      Regra de cálculo ainda não montada. Toque para montar (com a IA ou no editor).
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
