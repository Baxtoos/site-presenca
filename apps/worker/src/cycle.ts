import type { Db } from "@presenca/db";
import type { Mailer } from "@presenca/emails/transport";
import type { SafeFetchOptions } from "@presenca/integrations";
import type { Pool } from "pg";
import { type CleanupStats, cleanupExpired } from "./cleanup";
import { type DeliveryStats, processOutbox } from "./delivery";
import type { PushSender } from "./push";
import { syncMoodleConnections } from "./moodle-sync";
import { enqueueReminders } from "./reminders";
import { enqueueTaskReminders } from "./task-reminders";

export interface CycleDeps {
  pool: Pool;
  mailer: Mailer;
  push: PushSender;
  /** Endereço do app, sem barra no fim (links dos e-mails). */
  appUrl: string;
  now?: () => Date;
  /** Sincronização com o Moodle: só roda com o banco (Drizzle) e a chave das credenciais. */
  moodle?: { db: Db; key: Buffer; fetchOptions?: SafeFetchOptions };
  log?: (level: "info" | "warn", msg: string, extra?: Record<string, unknown>) => void;
}

export interface CycleResult {
  reminders: number;
  /** Conexões com o Moodle sincronizadas neste ciclo. */
  moodle: number;
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
  // Moodle antes dos avisos: uma entrega nova com prazo perto já sai neste mesmo ciclo.
  const moodle = deps.moodle
    ? await step("sincronização do moodle", 0, () =>
        syncMoodleConnections({
          pool: deps.pool,
          db: deps.moodle!.db,
          key: deps.moodle!.key,
          fetchOptions: deps.moodle!.fetchOptions,
          now: now(),
          log: deps.log,
        }),
      )
    : 0;
  const reminders =
    (await step("lembretes de chamada", 0, () => enqueueReminders(deps.pool, now()))) +
    (await step("avisos de tarefas", 0, () => enqueueTaskReminders(deps.pool, now())));
  const delivery = await processOutbox(deps);
  const cleanup = options.cleanup ? await cleanupExpired(deps.pool) : null;
  if (errors.length > 0) throw errors[0];
  return { reminders, moodle, delivery, cleanup };
}

export const didWork = (r: CycleResult) =>
  r.reminders +
    r.moodle +
    r.delivery.sent +
    r.delivery.failed +
    r.delivery.skipped +
    r.delivery.postponed >
  0;
