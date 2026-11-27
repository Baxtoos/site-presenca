import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, pk } from "./_shared";
import { templateKind } from "./enums";
import { users } from "./identity";

/** Snapshot da estrutura de um semestre ou matéria. Nunca contém faltas. */
export const sharedTemplates = app.table(
  "shared_templates",
  {
    id: pk(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: templateKind().notNull(),
    code: text().notNull(),
    title: text().notNull(),
    institution: text(),
    course: text(),
    payload: jsonb().notNull(),
    payloadVersion: smallint().notNull().default(1),
    expiresAt: timestamp({ withTimezone: true }),
    maxUses: integer(),
    usesCount: integer().notNull().default(0),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shared_templates_code_key").on(t.code),
    index("shared_templates_owner_idx").on(t.ownerId),
    check("shared_templates_code_chk", sql`${t.code} ~ '^[0-9A-HJKMNP-TV-Z]{8}$'`),
    check("shared_templates_title_chk", sql`char_length(${t.title}) between 1 and 120`),
    check(
      "shared_templates_uses_chk",
      sql`${t.usesCount} >= 0 and (${t.maxUses} is null or ${t.maxUses} > 0)`,
    ),
  ],
);

export const templateImports = app.table(
  "template_imports",
  {
    id: pk(),
    templateId: uuid()
      .notNull()
      .references(() => sharedTemplates.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** FK composta (created_semester_id, user_id) criada na migration de segurança. */
    createdSemesterId: uuid(),
    importedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("template_imports_template_idx").on(t.templateId),
    index("template_imports_user_idx").on(t.userId),
  ],
);
