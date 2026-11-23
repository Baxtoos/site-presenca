import { remindLabel, type Task, TASK_REMIND_OPTIONS } from "@presenca/contracts";

const WEEKDAY_SHORT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

/** "sex., 28/11 às 23:59" a partir do prazo local que a API devolve. */
export function dueLabel(task: Pick<Task, "dueLocal">): string {
  const { date, time } = task.dueLocal;
  const weekday = WEEKDAY_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const [, month, day] = date.split("-");
  return `${weekday}, ${day}/${month} às ${time}`;
}

/** "vence em 2 dias", "vence em 3 h", "venceu há 1 dia". */
export function dueRelative(task: Pick<Task, "dueAt">, now: Date): string {
  const diff = new Date(task.dueAt).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const amount =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))} min`
      : hours < 36
        ? `${hours} h`
        : `${days} ${days === 1 ? "dia" : "dias"}`;
  return diff >= 0 ? `vence em ${amount}` : `venceu há ${amount}`;
}

export type TaskGroupId = "overdue" | "soon" | "week" | "later";

export const TASK_GROUPS: { id: TaskGroupId; label: string }[] = [
  { id: "overdue", label: "Vencidas: falta registrar" },
  { id: "soon", label: "Próximas 48 h" },
  { id: "week", label: "Esta semana" },
  { id: "later", label: "Depois" },
];

/** Agrupa as pendentes pela proximidade do prazo. */
export function groupOf(task: Task, now: Date): TaskGroupId {
  if (task.overdue) return "overdue";
  const left = new Date(task.dueAt).getTime() - now.getTime();
  if (left <= 48 * 3_600_000) return "soon";
  if (left <= 7 * 86_400_000) return "week";
  return "later";
}

export const REMIND_CHOICES = TASK_REMIND_OPTIONS.map((m) => ({
  value: m,
  label: `${remindLabel(m)} antes`,
}));

export const STATUS_LABEL: Record<Task["status"], string> = {
  pending: "Pendente",
  completed: "Concluída",
  not_completed: "Não concluída",
};
