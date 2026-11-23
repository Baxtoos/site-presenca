import { taskSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { TaskIcon } from "@/components/icons";
import { TaskForm } from "@/components/tasks/task-form";
import { PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { currentSubjects } from "../../subjects";

export const metadata: Metadata = { title: "Editar tarefa · Monitor de Presenças" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, subjects] = await Promise.all([
    apiGet(`/v1/tasks/${id}`, taskSchema),
    currentSubjects(),
  ]);
  return (
    <>
      <PageHeader
        icon={<TaskIcon size={26} />}
        title="Editar tarefa"
        back={{ href: "/tarefas", label: "Tarefas" }}
      />
      <TaskForm task={task} subjects={subjects} />
    </>
  );
}
