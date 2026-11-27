import { sql } from "drizzle-orm";
import { customType, integer, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

export const app = pgSchema("app");

export const pk = () =>
  uuid()
    .primaryKey()
    .default(sql`app.uuid_v7()`);

/** Dono da linha. Toda tabela de dados do aluno tem esta coluna: o RLS filtra por ela. */
export const ownerId = () => uuid().notNull();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const version = () => integer().notNull().default(1);

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
