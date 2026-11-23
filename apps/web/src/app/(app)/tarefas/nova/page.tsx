import type { Metadata } from "next";
import { TaskIcon } from "@/components/icons";
import { TaskForm } from "@/components/tasks/task-form";
import { PageHeader } from "@/components/ui";
import { currentSubjects } from "../subjects";

export const metadata: Metadata = { title: "Nova tarefa · Monitor de Presenças" };

export default async function NewTaskPage() {
  return (
    <>
      <PageHeader
        icon={<TaskIcon size={26} />}
        title="Nova tarefa"
        back={{ href: "/tarefas", label: "Tarefas" }}
      />
      <TaskForm subjects={await currentSubjects()} />
    </>
  );
}
