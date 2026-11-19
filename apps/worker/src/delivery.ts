import { checkinPayloadSchema, notificationContent } from "@presenca/contracts";
import { noticeMessage } from "@presenca/emails";
import type { Mailer } from "@presenca/emails/transport";
import type { Pool } from "pg";
import {
  claim,
  closeExhausted,
  markFailed,
  markSent,
  markSkipped,
  type OutboxItem,
  postpone,
} from "./outbox";
import type { PushSender } from "./push";
import { inQuietWindow, localParts, quietWindowEnd, retryDelayMs } from "./time";

export interface DeliveryDeps {
  pool: Pool;
  mailer: Mailer;
  push: PushSender;
  /** Endereço do app, sem barra no fim (links dos e-mails). */
  appUrl: string;
  now?: () => Date;
  log?: (level: "info" | "warn", msg: string, extra?: Record<string, unknown>) => void;
}

interface Recipient {
  id: string;
  email: string;
  fullName: string;
  timezone: string;
  status: string;
  emailVerified: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
}

export interface DeliveryStats {
  sent: number;
  skipped: number;
  failed: number;
  postponed: number;
}

async function loadRecipients(pool: Pool, userIds: string[]): Promise<Map<string, Recipient>> {
  const { rows } = await pool.query<Recipient>(
    `select u.id, u.email, u.full_name as "fullName", u.timezone, u.status,
            u.email_verified_at is not null as "emailVerified",
            coalesce(p.email_enabled, true) as "emailEnabled",
            coalesce(p.push_enabled, false) as "pushEnabled",
            to_char(p.quiet_start, 'HH24:MI') as "quietStart",
            to_char(p.quiet_end, 'HH24:MI') as "quietEnd"
       from app.users u
       left join app.notification_preferences p on p.user_id = u.id
      where u.id = any($1::uuid[])`,
    [userIds],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

type Outcome =
  { kind: "sent" } | { kind: "skipped"; reason: string } | { kind: "failed"; error: string };

/**
 * Esvazia o que está vencido no outbox, lote a lote. Cada envio é decidido de novo na hora
 * (preferências e e-mail confirmado podem ter mudado desde que o alerta foi criado).
 */
export async function processOutbox(deps: DeliveryDeps, batchSize = 20): Promise<DeliveryStats> {
  const stats: DeliveryStats = { sent: 0, skipped: 0, failed: 0, postponed: 0 };
  const now = deps.now ?? (() => new Date());
  await closeExhausted(deps.pool);

  for (let round = 0; round < 50; round++) {
    const items = await claim(deps.pool, batchSize);
    if (items.length === 0) break;
    const recipients = await loadRecipients(deps.pool, [...new Set(items.map((i) => i.userId))]);

    for (const item of items) {
      const to = recipients.get(item.userId);
      if (!to || to.status !== "active") {
        await markSkipped(deps.pool, item.id, "conta inativa");
        stats.skipped++;
        continue;
      }
      if (to.quietStart && to.quietEnd) {
        const local = localParts(now(), to.timezone);
        if (inQuietWindow(local.minutes, to.quietStart, to.quietEnd)) {
          await postpone(deps.pool, item.id, quietWindowEnd(now(), to.timezone, to.quietEnd));
          stats.postponed++;
          continue;
        }
      }

      let outcome: Outcome;
      try {
        outcome =
          item.channel === "email"
            ? await sendEmail(deps, item, to)
            : await sendPush(deps, item, to);
      } catch (error) {
        outcome = { kind: "failed", error: error instanceof Error ? error.message : String(error) };
      }

      if (outcome.kind === "sent") {
        await markSent(deps.pool, item.id);
        stats.sent++;
      } else if (outcome.kind === "skipped") {
        await markSkipped(deps.pool, item.id, outcome.reason);
        stats.skipped++;
      } else {
        await markFailed(deps.pool, item.id, outcome.error, retryDelayMs(item.attempts));
        stats.failed++;
        deps.log?.("warn", "envio falhou; nova tentativa agendada", {
          notificationId: item.id,
          channel: item.channel,
          attempts: item.attempts,
          error: outcome.error,
        });
      }
    }
  }
  return stats;
}

function content(item: OutboxItem) {
  return notificationContent(item.kind, item.payload, item.subjectId);
}

async function sendEmail(deps: DeliveryDeps, item: OutboxItem, to: Recipient): Promise<Outcome> {
  if (!to.emailEnabled) return { kind: "skipped", reason: "e-mail desligado nas preferências" };
  if (!to.emailVerified) return { kind: "skipped", reason: "e-mail não confirmado" };
  const c = content(item);
  const message = noticeMessage({
    name: to.fullName.split(" ")[0] ?? to.fullName,
    title: c.title,
    body: c.body,
    url: `${deps.appUrl}${c.url}`,
    settingsUrl: `${deps.appUrl}/conta`,
  });
  // O id do aviso como chave: uma retentativa nunca entrega o mesmo e-mail duas vezes.
  await deps.mailer.send({ to: to.email, ...message }, { idempotencyKey: item.id });
  return { kind: "sent" };
}

async function sendPush(deps: DeliveryDeps, item: OutboxItem, to: Recipient): Promise<Outcome> {
  if (!deps.push.configured) return { kind: "skipped", reason: "push não configurado no servidor" };
  if (!to.pushEnabled) return { kind: "skipped", reason: "push desligado nas preferências" };
  const { rows: targets } = await deps.pool.query<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(`select id, endpoint, p256dh, auth from app.push_subscriptions where user_id = $1`, [to.id]);
  if (targets.length === 0) return { kind: "skipped", reason: "nenhum aparelho com push" };

  const c = content(item);
  const urgent = item.kind === "threshold";
  const classes =
    item.kind === "checkin_reminder"
      ? checkinPayloadSchema.safeParse(item.payload).data?.classes
      : undefined;
  const message = {
    ...c,
    tag: item.kind === "threshold" ? item.dedupeKey : item.kind,
    ...(classes?.length ? { classes } : {}),
  };
  let delivered = 0;
  let gone = 0;
  const errors: string[] = [];
  for (const target of targets) {
    const result = await deps.push.send(target, message, urgent);
    if (result.ok) {
      delivered++;
      await deps.pool.query(
        `update app.push_subscriptions set last_success_at = now(), failure_count = 0 where id = $1`,
        [target.id],
      );
    } else if (result.gone) {
      gone++;
      await deps.pool.query(`delete from app.push_subscriptions where id = $1`, [target.id]);
    } else {
      errors.push(result.error);
      // Aparelho que falha sempre (5 vezes seguidas) é descartado.
      const { rows } = await deps.pool.query<{ failures: number }>(
        `update app.push_subscriptions set failure_count = failure_count + 1
          where id = $1 returning failure_count as failures`,
        [target.id],
      );
      if ((rows[0]?.failures ?? 0) >= 5) {
        await deps.pool.query(`delete from app.push_subscriptions where id = $1`, [target.id]);
      }
    }
  }
  if (delivered > 0) return { kind: "sent" };
  if (gone === targets.length) return { kind: "skipped", reason: "aparelhos com push expirados" };
  return { kind: "failed", error: errors.join("; ").slice(0, 500) };
}
