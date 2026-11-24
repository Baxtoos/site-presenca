import { type Task, taskListSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, TaskIcon } from "@/components/icons";
import { TaskCard } from "@/components/tasks/task-card";
import { ButtonLink, PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { groupOf, TASK_GROUPS } from "@/lib/tasks";
import { SubjectFilter } from "./subject-filter";
import { currentSubjects } from "./subjects";

export const metadata: Metadata = { title: "Tarefas · Monitor de Presenças" };

const TABS = [
  { id: "pending", label: "Pendentes" },
  { id: "completed", label: "Concluídas" },
  { id: "not_completed", label: "Não concluídas" },
  { id: "todas", label: "Todas" },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tarefas e entregas: pendentes agrupadas pelo prazo, com filtro por status e matéria. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; materia?: string | string[] }>;
}) {
  const params = await searchParams;
  const status = TABS.find((t) => t.id === params.status)?.id ?? "pending";
  const materia =
    typeof params.materia === "string" && UUID.test(params.materia) ? params.materia : undefined;
  const query = new URLSearchParams({ limit: "100" });
  if (status !== "todas") query.set("status", status);
  if (materia) query.set("subjectId", materia);
  // Resolvidas: as mais recentes primeiro; pendentes: o prazo mais perto primeiro.
  if (status === "completed" || status === "not_completed") query.set("order", "due_desc");

  const [{ tasks }, subjects] = await Promise.all([
    apiGet(`/v1/tasks?${query}`, taskListSchema),
    currentSubjects(),
  ]);
  const now = new Date();
  const nowIso = now.toISOString();
  const tabHref = (id: string) => {
    const next = new URLSearchParams();
    if (id !== "pending") next.set("status", id);
    if (materia) next.set("materia", materia);
    const q = next.toString();
    return q ? `/tarefas?${q}` : "/tarefas";
  };
  const grouped =
    status === "pending"
      ? TASK_GROUPS.map((g) => ({
          ...g,
          items: tasks.filter((t) => groupOf(t, now) === g.id),
        })).filter((g) => g.items.length > 0)
      : [{ id: "all", label: "", items: tasks }];

  return (
    <>
      <PageHeader
        icon={<TaskIcon size={26} />}
        title="Tarefas"
        description="Trabalhos, listas e entregas com prazo. O app avisa antes do prazo e, depois, você conta se entregou."
        actions={
          <ButtonLink href="/tarefas/nova?voltar=/tarefas">
            <PlusIcon size={16} />
            Nova tarefa
          </ButtonLink>
        }
      />

      <nav aria-label="Filtrar por status" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            aria-current={status === t.id ? "page" : undefined}
            className={`min-h-9 rounded-md border px-3 py-1.5 text-sm transition-colors ${status === t.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong bg-surface text-muted hover:bg-surface-2"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {subjects.length > 0 ? <SubjectFilter subjects={subjects} /> : null}

      {tasks.length === 0 ? (
        <section className="card grid gap-3 p-6 text-sm">
          <p className="text-muted">
            {status === "pending"
              ? "Nenhuma tarefa pendente. Cadastre trabalhos e entregas para receber o aviso antes do prazo."
              : "Nada por aqui com esse filtro."}
          </p>
          {status === "pending" ? (
            <ButtonLink href="/tarefas/nova?voltar=/tarefas" variant="secondary" className="w-fit">
              Cadastrar tarefa
            </ButtonLink>
          ) : null}
        </section>
      ) : (
        grouped.map((g) => (
          <section key={g.id} className="grid gap-2" aria-labelledby={`grupo-${g.id}`}>
            {g.label ? (
              <h2
                id={`grupo-${g.id}`}
                className={`text-sm font-semibold ${g.id === "overdue" ? "text-fail" : "text-muted"}`}
              >
                {g.label} ({g.items.length})
              </h2>
            ) : (
              <h2 id={`grupo-${g.id}`} className="sr-only">
                Tarefas
              </h2>
            )}
            <ul className="grid gap-2">
              {g.items.map((t: Task) => (
                <TaskCard key={t.id} task={t} now={nowIso} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
