import type { Metadata } from "next";
import { TaskIcon } from "@/components/icons";
import { TaskForm } from "@/components/tasks/task-form";
import { PageHeader } from "@/components/ui";
import { backLink, isoDateParam, taskReturnPath } from "@/lib/tasks";
import { currentSubjects } from "../subjects";

export const metadata: Metadata = { title: "Nova tarefa · Monitor de Presenças" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ voltar?: string | string[]; data?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnTo = taskReturnPath(params.voltar);
  return (
    <>
      <PageHeader icon={<TaskIcon size={26} />} title="Nova tarefa" back={backLink(returnTo)} />
      <TaskForm
        subjects={await currentSubjects()}
        returnTo={returnTo}
        initialDate={isoDateParam(params.data)}
      />
    </>
  );
}
