"use client";

import { remindLabel, type Task } from "@presenca/contracts";
import Link from "next/link";
import { CheckCircleIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { SUBJECT_COLOR_CLASS } from "@/lib/format";
import { dueLabel, dueRelative, STATUS_LABEL } from "@/lib/tasks";
import { GradeHint } from "./grade-hint";
import { useTaskActions } from "./use-task-actions";

/**
 * Uma tarefa: prazo, matéria e, enquanto pendente, os botões para registrar se foi entregue.
 * Vencida e pendente ganha destaque; resolvida pode ser corrigida (volta para pendente ou troca).
 */
export function TaskCard({ task, now }: { task: Task; now: string }) {
  const { pending, setStatus, remove, confirmDelete, setConfirmDelete } = useTaskActions(task);
  const soon =
    task.status === "pending" &&
    !task.overdue &&
    new Date(task.dueAt).getTime() - new Date(now).getTime() <= 48 * 3_600_000;

  const tone = task.overdue
    ? "border-fail/50 bg-fail-soft/40"
    : soon
      ? "border-warn/50 bg-warn-soft/30"
      : "border-line";

  return (
    <li
      className={`relative grid gap-2 rounded-xl border p-3 pl-4 text-sm ${tone}`}
      data-testid="tarefa"
      data-status={task.status}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl ${task.subject?.color ? SUBJECT_COLOR_CLASS[task.subject.color] : "bg-line-strong"}`}
        aria-hidden
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <strong className="break-words text-[15px]">{task.title}</strong>
          <span className="text-xs text-muted">
            {task.subject ? `${task.subject.name} · ` : ""}prazo {dueLabel(task)}
            {task.source !== "manual" ? (
              <span className="ml-1.5 rounded border border-line px-1 py-px text-[11px]">
                Moodle
              </span>
            ) : null}
          </span>
        </div>
        {task.status === "pending" ? (
          <span
            className={`shrink-0 text-xs font-medium ${task.overdue ? "text-fail" : soon ? "text-warn" : "text-muted"}`}
          >
            {dueRelative(task, new Date(now))}
          </span>
        ) : (
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${task.status === "completed" ? "text-ok" : "text-fail"}`}
          >
            {task.status === "completed" ? <CheckCircleIcon size={14} /> : null}
            {STATUS_LABEL[task.status]}
          </span>
        )}
      </div>
      {task.notes ? <p className="whitespace-pre-wrap text-muted">{task.notes}</p> : null}
      <GradeHint task={task} />
      {task.overdue ? (
        <p className="font-medium text-fail">O prazo passou. Você entregou?</p>
      ) : task.status === "pending" ? (
        <p className="text-xs text-muted">
          {task.remindBeforeMinutes === null
            ? "Sem aviso."
            : `Aviso ${remindLabel(task.remindBeforeMinutes)} antes do prazo.`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
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
          <>
            <Button
              type="button"
              variant="ghost"
              loading={pending === "pending"}
              disabled={pending !== null}
              onClick={() => void setStatus("pending", "Tarefa voltou para pendente.")}
            >
              Voltar para pendente
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending !== null}
              onClick={() =>
                void setStatus(
                  task.status === "completed" ? "not_completed" : "completed",
                  "Tarefa corrigida.",
                )
              }
            >
              {task.status === "completed" ? "Mudar para não concluída" : "Mudar para concluída"}
            </Button>
          </>
        )}
        {task.externalUrl ? (
          <a
            href={task.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-9 rounded-md px-2 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            Abrir atividade<span className="sr-only"> (abre em nova aba)</span>
          </a>
        ) : null}
        <Link
          href={`/tarefas/${task.id}/editar?voltar=/tarefas`}
          className="ml-auto min-h-9 rounded-md px-2 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
        >
          Editar
        </Link>
        {task.source !== "manual" ? null : confirmDelete ? (
          <Button
            type="button"
            variant="danger"
            loading={pending === "delete"}
            onClick={() => void remove()}
          >
            Confirmar exclusão
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={pending !== null}
            onClick={() => setConfirmDelete(true)}
          >
            Excluir
          </Button>
        )}
      </div>
    </li>
  );
}
