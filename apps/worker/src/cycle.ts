import type { Mailer } from "@presenca/emails/transport";
import type { Pool } from "pg";
import { type CleanupStats, cleanupExpired } from "./cleanup";
import { type DeliveryStats, processOutbox } from "./delivery";
import type { PushSender } from "./push";
import { enqueueReminders } from "./reminders";
import { enqueueTaskReminders } from "./task-reminders";

export interface CycleDeps {
  pool: Pool;
  mailer: Mailer;
  push: PushSender;
  /** Endereço do app, sem barra no fim (links dos e-mails). */
  appUrl: string;
  now?: () => Date;
  log?: (level: "info" | "warn", msg: string, extra?: Record<string, unknown>) => void;
}

export interface CycleResult {
  reminders: number;
  delivery: DeliveryStats;
  cleanup: CleanupStats | null;
}

/**
 * Um ciclo completo do worker: lembretes vencidos viram avisos, o outbox é esvaziado e, se pedido,
 * dados expirados são apagados. É o mesmo ciclo no modo contínuo (loop) e no modo pontual (once).
 */
export async function runCycle(
  deps: CycleDeps,
  options: { cleanup: boolean },
): Promise<CycleResult> {
  const now = deps.now ?? (() => new Date());
  // Uma etapa que falha não segura as outras: o outbox (avisos de faltas já na fila) sempre sai.
  // O primeiro erro volta no fim, para o modo pontual terminar com falha e o alerta disparar.
  const errors: unknown[] = [];
  const step = async <T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      deps.log?.("warn", `etapa do ciclo falhou: ${name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      errors.push(error);
      return fallback;
    }
  };
  const reminders =
    (await step("lembretes de chamada", 0, () => enqueueReminders(deps.pool, now()))) +
    (await step("avisos de tarefas", 0, () => enqueueTaskReminders(deps.pool, now())));
  const delivery = await processOutbox(deps);
  const cleanup = options.cleanup ? await cleanupExpired(deps.pool) : null;
  if (errors.length > 0) throw errors[0];
  return { reminders, delivery, cleanup };
}

export const didWork = (r: CycleResult) =>
  r.reminders + r.delivery.sent + r.delivery.failed + r.delivery.skipped + r.delivery.postponed > 0;
