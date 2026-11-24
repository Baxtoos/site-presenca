import { taskListSchema } from "@presenca/contracts";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ButtonLink, SectionTitle } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { SUBJECT_COLOR_CLASS } from "@/lib/format";
import { dueLabel, dueRelative } from "@/lib/tasks";

/**
 * Resumo de entregas (Início e Hoje): vencidas sem registro e as que vencem logo. Some quando não
 * há nada, para não ocupar espaço.
 */
export async function UpcomingTasks({ days, title }: { days: number; title: string }) {
  const now = new Date();
  const limit = now.getTime() + days * 86_400_000;
  // Só até o fim da janela (as vencidas vêm primeiro). Um resumo que falha não derruba a página.
  const to = new Date(limit + 86_400_000).toISOString().slice(0, 10);
  const tasks = await apiGet(`/v1/tasks?status=pending&to=${to}&limit=50`, taskListSchema)
    .then((r) => r.tasks)
    .catch((error: unknown) => {
      unstable_rethrow(error); // redirecionamento para o login continua valendo
      return null;
    });
  if (!tasks) return null;
  const relevant = tasks.filter((t) => t.overdue || new Date(t.dueAt).getTime() <= limit);
  if (relevant.length === 0) return null;
  const overdue = relevant.filter((t) => t.overdue).length;
  const shown = relevant.slice(0, 3);
  return (
    <section className="grid gap-3" aria-labelledby="proximas-entregas">
      <SectionTitle
        id="proximas-entregas"
        action={
          <ButtonLink href="/calendario" variant="ghost" className="-mr-2">
            Ver tarefas
          </ButtonLink>
        }
      >
        {title}
      </SectionTitle>
      {overdue > 0 ? (
        <p className="text-sm font-medium text-fail">
          {overdue === 1
            ? "1 tarefa passou do prazo: conte se você entregou."
            : `${overdue} tarefas passaram do prazo: conte se você entregou.`}
        </p>
      ) : null}
      <ul className="card divide-y divide-line overflow-hidden" data-testid="proximas-entregas">
        {shown.map((t) => (
          <li key={t.id}>
            <Link
              href="/calendario"
              className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2"
            >
              <span
                className={`size-2.5 shrink-0 rounded-full ${t.subject?.color ? SUBJECT_COLOR_CLASS[t.subject.color] : "bg-line-strong"}`}
                aria-hidden
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{t.title}</span>
                <span className="truncate text-xs text-muted">
                  {t.subject ? `${t.subject.name} · ` : ""}
                  {dueLabel(t)}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${t.overdue ? "text-fail" : "text-warn"}`}
              >
                {dueRelative(t, now)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
