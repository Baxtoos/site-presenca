"use client";

import type { Task } from "@presenca/contracts";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { useTaskActions } from "@/components/tasks/use-task-actions";
import { TONE, taskTone } from "@/lib/calendar";
import { GradeHint } from "@/components/tasks/grade-hint";
import { SUBJECT_COLOR_CLASS } from "@/lib/format";

/**
 * Uma tarefa na linha do tempo ou no dia escolhido do calendário: horário, matéria, status e as
 * ações rápidas (Concluída, Não concluída, Reabrir, Editar, Abrir atividade).
 */
export function TaskRow({ task, showDate }: { task: Task; showDate?: string }) {
  const { pending, setStatus } = useTaskActions(task);
  const pathname = usePathname();
  const params = useSearchParams();
  const here = params.size > 0 ? `${pathname}?${params}` : pathname;
  const tone = taskTone(task);
  const subtitle = [
    TONE[tone].label,
    task.subject?.name,
    task.subject?.code,
    task.subject?.semesterLabel,
  ].filter(Boolean);

  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm"
      data-testid="linha-tarefa"
      data-status={tone}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={`mt-1 h-8 w-1 shrink-0 rounded-full ${task.subject?.color ? SUBJECT_COLOR_CLASS[task.subject.color] : "bg-line-strong"}`}
          aria-hidden
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-mono text-xs font-medium tabular-nums ${TONE[tone].text}`}>
              {showDate ? `${showDate} · ` : ""}
              {task.dueLocal.time}
            </span>
            <strong className="break-words font-medium">{task.title}</strong>
            {task.source !== "manual" ? (
              <span className="rounded border border-line px-1 py-px text-[11px] text-muted">
                Moodle
              </span>
            ) : null}
          </span>
          <span className="text-xs text-muted">{subtitle.join(" · ")}</span>
          <GradeHint task={task} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {task.status === "pending" ? (
          <>
            <Button
              type="button"
              variant={task.overdue ? "primary" : "secondary"}
              loading={pending === "completed"}
              disabled={pending !== null}
              onClick={() => void setStatus("completed", "Tarefa marcada como concluída.")}
            >
              Concluída
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={pending === "not_completed"}
              disabled={pending !== null}
              onClick={() => void setStatus("not_completed", "Tarefa marcada como não concluída.")}
            >
              Não concluída
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            loading={pending === "pending"}
            disabled={pending !== null}
            onClick={() => void setStatus("pending", "Tarefa reaberta.")}
          >
            Reabrir
          </Button>
        )}
        <Link
          href={`/tarefas/${task.id}/editar?voltar=${encodeURIComponent(here)}`}
          className="min-h-9 rounded-md px-2 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
          aria-label={`Editar ${task.title}`}
        >
          Editar
        </Link>
        {task.externalUrl ? (
          <a
            href={task.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-9 rounded-md px-2 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            Abrir<span className="sr-only"> {task.title} (abre em nova aba)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}
