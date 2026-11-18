import { semesterSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { NewSubjectWizard } from "@/components/subject-form";
import { apiGet } from "@/lib/api-server";

export const metadata: Metadata = { title: "Nova matéria · Monitor de Presenças" };

export default async function NewSubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const semester = await apiGet(`/v1/semesters/${id}`, semesterSchema);
  return (
    <>
      <header className="grid gap-1">
        <Link href={`/semestres/${semester.id}`} className="text-sm text-muted hover:text-ink">
          ← {semester.label}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Nova matéria</h1>
        <p className="text-sm text-muted">
          Use a regra que está no plano de ensino ou que o professor informou.
        </p>
      </header>
      <NewSubjectWizard semesterId={semester.id} />
    </>
  );
}
