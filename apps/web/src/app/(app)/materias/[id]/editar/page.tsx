import { subjectSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { SharePanel } from "@/components/sharing/share-panel";
import { EditSubjectForm } from "@/components/subject-form";
import { apiGet, getMe } from "@/lib/api-server";
import { DeleteSubject, ScheduleManager } from "../subject-client";

export const metadata: Metadata = { title: "Editar matéria · Monitor de Presenças" };

/** Configurações da matéria: horários, dados, compartilhamento e exclusão. */
export default async function EditSubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, subject] = await Promise.all([getMe(), apiGet(`/v1/subjects/${id}`, subjectSchema)]);

  return (
    <>
      <header className="grid gap-1">
        <Link href={`/materias/${subject.id}`} className="text-sm text-muted hover:text-ink">
          ← {subject.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Editar matéria</h1>
      </header>

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

      <section
        className="grid gap-3 rounded-2xl border border-fail/30 bg-surface p-6"
        aria-labelledby="zona-perigo"
      >
        <h2 id="zona-perigo" className="font-semibold">
          Apagar matéria
        </h2>
        <DeleteSubject subject={subject} />
      </section>
    </>
  );
}
