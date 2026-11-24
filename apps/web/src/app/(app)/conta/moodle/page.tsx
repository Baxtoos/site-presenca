import { moodleStatusSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { CalendarIcon } from "@/components/icons";
import { MoodlePanel } from "@/components/moodle/moodle-panel";
import { PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { currentSubjects } from "../../tarefas/subjects";

export const metadata: Metadata = { title: "Moodle · Monitor de Presenças" };

export default async function MoodlePage() {
  const [status, subjects] = await Promise.all([
    apiGet("/v1/moodle", moodleStatusSchema),
    currentSubjects(),
  ]);
  return (
    <>
      <PageHeader
        icon={<CalendarIcon size={26} />}
        title="Moodle"
        description="Traga do Moodle as entregas com prazo: elas entram no calendário, com aviso antes do prazo, e se atualizam sozinhas quando o professor muda a data."
        back={{ href: "/conta", label: "Conta" }}
      />
      <MoodlePanel initial={status} subjects={subjects} />
    </>
  );
}
