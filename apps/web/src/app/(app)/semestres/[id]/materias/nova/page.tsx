import { semesterSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { NewSubjectWizard } from "@/components/subject-form";
import { apiGet } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";
import { SparkIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Nova matéria · Monitor de Presenças" };

export default async function NewSubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const semester = await apiGet(`/v1/semesters/${id}`, semesterSchema);
  return (
    <>
      <PageHeader
        back={{ href: `/semestres/${semester.id}`, label: `← ${semester.label}` }}
        icon={<SparkIcon size={26} />}
        title="Nova matéria"
        description="Use a regra que está no plano de ensino ou que o professor informou."
      />
      <NewSubjectWizard semesterId={semester.id} />
    </>
  );
}
