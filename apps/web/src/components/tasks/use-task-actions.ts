"use client";

import type { Task } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";

export function useTaskActions(task: Pick<Task, "id" | "version" | "status">) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(label: string, action: () => Promise<unknown>, success: string) {
    setPending(label);
    try {
      await action();
      toast.push({ tone: "success", message: success });
    } catch (e) {
      const stale = e instanceof ApiError && e.problem.status === 412;
      toast.push({
        tone: "error",
        message: stale
          ? "Esta tarefa mudou em outro lugar. A lista foi atualizada; tente de novo."
          : e instanceof ApiError
            ? e.message
            : "Não foi possível salvar.",
      });
    } finally {
      router.refresh();
      setPending(null);
      setConfirmDelete(false);
    }
  }

  const setStatus = (status: Task["status"], message: string) =>
    run(
      status,
      () =>
        api(`/v1/tasks/${task.id}`, { method: "PATCH", ifMatch: task.version, body: { status } }),
      message,
    );

  const remove = () =>
    run(
      "delete",
      () => api(`/v1/tasks/${task.id}`, { method: "DELETE", ifMatch: task.version }),
      "Tarefa apagada.",
    );

  return { pending, setStatus, remove, confirmDelete, setConfirmDelete };
}
