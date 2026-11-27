import { sql } from "drizzle-orm";
import { check, index, jsonb, primaryKey, smallint, text, uuid } from "drizzle-orm/pg-core";
import { app, bytea, createdAt } from "./_shared";
import { users } from "./identity";

export const idempotencyKeys = app.table(
  "idempotency_keys",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text().notNull(),
    requestHash: bytea().notNull(),
    statusCode: smallint().notNull(),
    responseBody: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "idempotency_keys_pk", columns: [t.userId, t.key] }),
    index("idempotency_keys_created_idx").on(t.createdAt),
    check("idempotency_keys_key_chk", sql`char_length(${t.key}) between 8 and 128`),
    check("idempotency_keys_status_chk", sql`${t.statusCode} between 200 and 599`),
  ],
);
