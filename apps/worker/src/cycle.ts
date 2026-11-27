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
  appUrl: string;
  now?: () => Date;
  moodle?: { db: Db; key: Buffer; fetchOptions?: SafeFetchOptions };
  log?: (level: "info" | "warn", msg: string, extra?: Record<string, unknown>) => void;
}

export interface CycleResult {
  reminders: number;
  moodle: number;
  delivery: DeliveryStats;
  cleanup: CleanupStats | null;
}

export async function runCycle(
  deps: CycleDeps,
  options: { cleanup: boolean },
): Promise<CycleResult> {
  const now = deps.now ?? (() => new Date());
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
