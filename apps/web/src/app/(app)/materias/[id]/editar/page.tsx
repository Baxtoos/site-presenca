import { subjectSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { SharePanel } from "@/components/sharing/share-panel";
import { EditSubjectForm } from "@/components/subject-form";
import { PageHeader } from "@/components/ui";
import { apiGet, getMe } from "@/lib/api-server";
import { DeleteSubject, ScheduleManager } from "../subject-client";
import { SettingsIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Editar matéria · Monitor de Presenças" };

export default async function EditSubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, subject] = await Promise.all([getMe(), apiGet(`/v1/subjects/${id}`, subjectSchema)]);

  return (
    <>
      <PageHeader
        back={{ href: `/materias/${subject.id}`, label: `← ${subject.name}` }}
        icon={<SettingsIcon size={26} />}
        title="Editar matéria"
        description={`Horários, regras de falta, compartilhamento e exclusão de ${subject.name}.`}
      />

      <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="grade">
        <h2 id="grade" className="text-lg font-semibold tracking-tight">
          Horários na semana
        </h2>
        <ScheduleManager
          subjectId={subject.id}
          schedules={subject.schedules}
          defaultUnits={subject.unitsPerClass}
        />
      </section>

      <section className="card p-5 sm:p-6">
        <EditSubjectForm key={subject.version} subject={subject} />
      </section>

      <section className="grid gap-3 card p-5 sm:p-6" aria-labelledby="compartilhar">
        <div className="grid gap-1">
          <h2 id="compartilhar" className="text-lg font-semibold tracking-tight">
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

      <section
        className="grid gap-3 rounded-xl border border-fail/30 bg-surface p-6"
        aria-labelledby="zona-perigo"
      >
        <h2 id="zona-perigo" className="text-lg font-semibold tracking-tight">
          Apagar matéria
        </h2>
        <DeleteSubject subject={subject} />
      </section>
    </>
  );
}
