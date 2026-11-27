import type { CalendarDayException, Task } from "@presenca/contracts";
import { addDays } from "@presenca/engine";

export type TaskTone = "pending" | "overdue" | "completed" | "not_completed";

export function taskTone(task: Pick<Task, "status" | "overdue">): TaskTone {
  if (task.status === "pending") return task.overdue ? "overdue" : "pending";
  return task.status;
}

export const TONE: Record<TaskTone, { label: string; dot: string; chip: string; text: string }> = {
  pending: {
    label: "Pendente",
    dot: "bg-accent",
    chip: "border-accent/40 bg-accent-soft text-ink",
    text: "text-accent",
  },
  overdue: {
    label: "Atrasada",
    dot: "bg-fail",
    chip: "border-fail/50 bg-fail-soft text-ink",
    text: "text-fail",
  },
  completed: {
    label: "Concluída",
    dot: "bg-ok",
    chip: "border-ok/40 bg-ok-soft text-muted line-through decoration-ok/60",
    text: "text-ok",
  },
  not_completed: {
    label: "Não concluída",
    dot: "bg-line-strong",
    chip: "border-line-strong bg-surface-2 text-muted",
    text: "text-muted",
  },
};

export const EXCEPTION_LABEL: Record<CalendarDayException["kind"], string> = {
  holiday: "Feriado",
  no_classes: "Sem aula",
  exam_week: "Semana de provas",
};

const DAY_LONG = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_LONG = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_SHORT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

export const dayLong = (date: string) => DAY_LONG.format(new Date(`${date}T12:00:00Z`));
export const monthLong = (month: string) => MONTH_LONG.format(new Date(`${month}-15T12:00:00Z`));
export const dayShort = (date: string) => DAY_SHORT.format(new Date(`${date}T12:00:00Z`));

export const TIMELINE_WINDOWS = [
  { id: "atrasadas", label: "Atrasadas" },
  { id: "hoje", label: "Hoje" },
  { id: "7", label: "Próximos 7 dias" },
  { id: "30", label: "Próximos 30 dias" },
  { id: "todas", label: "Todas" },
] as const;
export type TimelineWindow = (typeof TIMELINE_WINDOWS)[number]["id"];

export const TIMELINE_STATUS = [
  { id: "pendentes", label: "Pendentes", status: "pending" },
  { id: "todas", label: "Todas", status: undefined },
  { id: "concluidas", label: "Concluídas", status: "completed" },
  { id: "nao-concluidas", label: "Não concluídas", status: "not_completed" },
] as const;
export type TimelineStatus = (typeof TIMELINE_STATUS)[number]["id"];

export function windowRange(window: TimelineWindow, today: string): { from: string; to: string } {
  switch (window) {
    case "atrasadas":
      return { from: addDays(today, -399), to: today };
    case "hoje":
      return { from: today, to: today };
    case "7":
      return { from: today, to: addDays(today, 6) };
    case "30":
      return { from: today, to: addDays(today, 29) };
    case "todas":
      return { from: addDays(today, -200), to: addDays(today, 199) };
  }
}

export function todayIn(timezone: string, now = new Date()): string {
  try {
    return now.toLocaleDateString("en-CA", { timeZone: timezone });
  } catch {
    return now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  }
}
