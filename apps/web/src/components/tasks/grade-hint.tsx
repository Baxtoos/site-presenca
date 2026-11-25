import type { Task } from "@presenca/contracts";
import { formatGrade } from "@presenca/engine";
import Link from "next/link";

/**
 * Tarefa ligada a uma avaliação: depois de entregue mostra "aguardando nota" com o atalho para
 * lançar (na seção Notas da matéria), ou a nota já lançada.
 */
export function GradeHint({ task }: { task: Task }) {
  const ev = task.evaluation;
  if (!ev || !task.subjectId) return null;
  if (ev.score !== null) {
    return (
      <span className="text-xs text-muted" data-testid="nota-da-tarefa">
        {ev.name}: nota {formatGrade(ev.score)} de {formatGrade(ev.maxScore)}
      </span>
    );
  }
  if (task.status === "pending") return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs" data-testid="nota-da-tarefa">
      <span className={task.status === "completed" ? "font-medium text-ok" : "text-fail"}>
        {task.status === "completed" ? "Entregue · aguardando nota" : `Não entregue (${ev.name})`}
      </span>
      <Link
        href={`/materias/${task.subjectId}#notas`}
        className="font-medium text-accent underline-offset-4 hover:underline"
      >
        Lançar nota
      </Link>
    </span>
  );
}
