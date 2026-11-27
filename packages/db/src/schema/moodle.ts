import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, ownerId, pk, updatedAt, version } from "./_shared";
import { users } from "./identity";

export const moodleConnections = app.table(
  "moodle_connections",
  {
    id: pk(),
    userId: ownerId().references(() => users.id, { onDelete: "cascade" }),
    icsHost: text().notNull(),
    icsUrlEnc: text().notNull(),
    baseUrl: text(),
    wstokenEnc: text(),
    syncEnabled: boolean().notNull().default(true),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastSyncError: text(),
    nextSyncAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("moodle_connections_user_key").on(t.userId),
    index("moodle_connections_next_sync_idx")
      .on(t.nextSyncAt)
      .where(sql`${t.syncEnabled}`),
    check(
      "moodle_connections_base_url_chk",
      sql`${t.baseUrl} is null or (${t.baseUrl} ~ '^https://' and char_length(${t.baseUrl}) <= 300)`,
    ),
    check("moodle_connections_token_chk", sql`${t.wstokenEnc} is null or ${t.baseUrl} is not null`),
    check(
      "moodle_connections_error_chk",
      sql`${t.lastSyncError} is null or char_length(${t.lastSyncError}) <= 300`,
    ),
    check("moodle_connections_host_chk", sql`char_length(${t.icsHost}) between 1 and 255`),
  ],
);

export const moodleCourseMappings = app.table(
  "moodle_course_mappings",
  {
    id: pk(),
    userId: ownerId(),
    courseKey: text().notNull(),
    subjectId: uuid(),
    ignored: boolean().notNull().default(false),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("moodle_course_mappings_user_course_key").on(t.userId, t.courseKey),
    foreignKey({
      name: "moodle_course_mappings_connection_fk",
      columns: [t.userId],
      foreignColumns: [moodleConnections.userId],
    }).onDelete("cascade"),
    check("moodle_course_mappings_course_chk", sql`char_length(${t.courseKey}) between 1 and 200`),
    check(
      "moodle_course_mappings_ignored_chk",
      sql`not (${t.ignored} and ${t.subjectId} is not null)`,
    ),
  ],
);
