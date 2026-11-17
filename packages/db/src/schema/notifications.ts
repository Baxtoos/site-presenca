import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, pk, updatedAt } from "./_shared";
import { checkinMode, notificationChannel, notificationKind, notificationStatus } from "./enums";
import { users } from "./identity";

export const notificationPreferences = app.table(
  "notification_preferences",
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    emailEnabled: boolean().notNull().default(true),
    pushEnabled: boolean().notNull().default(false),
    thresholds: smallint()
      .array()
      .notNull()
      .default(sql`'{50,75,90,100}'::smallint[]`),
    checkinReminder: checkinMode().notNull().default("off"),
    checkinTime: time().notNull().default("21:00"),
    checkinWeekday: smallint().notNull().default(5),
    quietStart: time(),
    quietEnd: time(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "notification_preferences_thresholds_chk",
      sql`${t.thresholds} <@ '{50,75,90,100}'::smallint[]`,
    ),
    check("notification_preferences_weekday_chk", sql`${t.checkinWeekday} between 1 and 7`),
    check(
      "notification_preferences_quiet_chk",
      sql`(${t.quietStart} is null) = (${t.quietEnd} is null)`,
    ),
  ],
);

export const pushSubscriptions = app.table(
  "push_subscriptions",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
    lastSuccessAt: timestamp({ withTimezone: true }),
    failureCount: smallint().notNull().default(0),
  },
  (t) => [
    unique("push_subscriptions_endpoint_key").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
    check("push_subscriptions_endpoint_chk", sql`${t.endpoint} like 'https://%'`),
  ],
);

/** Outbox de envio, histórico e caixa in-app numa tabela só. */
export const notificationLogs = app.table(
  "notification_logs",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** FK composta (subject_id, user_id) criada na migration de segurança. */
    subjectId: uuid(),
    kind: notificationKind().notNull(),
    channel: notificationChannel().notNull(),
    thresholdPct: smallint(),
    cycle: integer(),
    dedupeKey: text().notNull(),
    status: notificationStatus().notNull().default("pending"),
    attempts: smallint().notNull().default(0),
    lastError: text(),
    payload: jsonb().notNull().default({}),
    scheduledFor: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("notification_logs_dedupe_key").on(t.dedupeKey, t.channel),
    index("notification_logs_user_idx").on(t.userId, t.createdAt.desc()),
    index("notification_logs_due_idx")
      .on(t.scheduledFor)
      .where(sql`${t.status} in ('pending', 'failed')`),
    check(
      "notification_logs_threshold_chk",
      sql`${t.kind} <> 'threshold' or coalesce(${t.thresholdPct} in (50, 75, 90, 100) and ${t.cycle} >= 1 and ${t.subjectId} is not null, false)`,
    ),
    check("notification_logs_attempts_chk", sql`${t.attempts} between 0 and 10`),
  ],
);
