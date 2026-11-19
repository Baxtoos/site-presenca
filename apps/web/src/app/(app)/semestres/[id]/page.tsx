import {
  exceptionsResponseSchema,
  semesterSchema,
  subjectsResponseSchema,
} from "@presenca/contracts";
import type { Metadata } from "next";
import { CalendarIcon, PlusIcon } from "@/components/icons";
import { SubjectCard } from "@/components/subject-card";
import { ButtonLink, PageHeader, SectionTitle } from "@/components/ui";
import { SharePanel } from "@/components/sharing/share-panel";
import { apiGet, getMe } from "@/lib/api-server";
import { formatDate } from "@/lib/format";
import { SemesterActions } from "../semester-forms";
import { ExceptionsManager } from "./exceptions-manager";

export const metadata: Metadata = { title: "Semestre · Monitor de Presenças" };

export default async function SemesterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, semester, { subjects }, { exceptions }] = await Promise.all([
    getMe(),
    apiGet(`/v1/semesters/${id}`, semesterSchema),
    apiGet(`/v1/semesters/${id}/subjects`, subjectsResponseSchema),
    apiGet(`/v1/semesters/${id}/exceptions`, exceptionsResponseSchema),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/semestres", label: "← Semestres" }}
        icon={<CalendarIcon size={26} />}
        title={
          <>
            {semester.label}
            {semester.isCurrent ? (
              <span className="ml-3 rounded-md bg-accent-soft px-2 py-1 align-middle text-sm font-medium text-accent">
                atual
              </span>
            ) : null}
            {semester.status === "archived" ? (
              <span className="ml-3 rounded-md bg-surface-2 px-2 py-1 align-middle text-sm font-medium text-muted">
                arquivado
              </span>
            ) : null}
          </>
        }
        description={`Aulas de ${formatDate(semester.startsOn)} a ${formatDate(semester.endsOn)}`}
      />

      <section className="grid gap-3" aria-labelledby="materias">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle id="materias">Matérias</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/v1/semesters/${semester.id}/export.xlsx`}
              download
              className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 sm:min-h-10"
            >
              Exportar Excel (.xlsx)
            </a>
            <ButtonLink href={`/semestres/${semester.id}/materias/nova`}>
              <PlusIcon size={16} />
              Adicionar matéria
            </ButtonLink>
          </div>
        </div>
        {subjects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">
            Nenhuma matéria ainda. Cada matéria tem sua própria regra de faltas.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {subjects.map((subject) => (
              <SubjectCard key={subject.id} subject={subject} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="feriados">
        <div className="grid gap-1">
          <h2 id="feriados" className="text-lg font-semibold tracking-tight">
            Feriados e dias sem aula
          </h2>
          <p className="text-sm text-muted">
            Dias sem aula não contam como falta e não entram no “posso faltar?”.
          </p>
        </div>
        <ExceptionsManager
          semester={semester}
          exceptions={exceptions}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
        />
      </section>

      <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="compartilhar">
        <div className="grid gap-1">
          <h2 id="compartilhar" className="text-lg font-semibold tracking-tight">
            Compartilhar com colegas
          </h2>
          <p className="text-sm text-muted">
            Gere um código para a turma importar as mesmas matérias, horários e feriados. Suas
            faltas não vão junto.
          </p>
        </div>
        <SharePanel
          source={{ kind: "semester", semesterId: semester.id }}
          defaultTitle={semester.label}
          emailVerified={me?.emailVerified ?? false}
        />
      </section>

      <section className="grid gap-3" aria-labelledby="acoes">
        <h2 id="acoes" className="text-sm font-semibold text-muted">
          Ações do semestre
        </h2>
        <SemesterActions semester={semester} />
      </section>
    </>
  );
}
