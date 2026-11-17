import { sql } from "drizzle-orm";
import { customType, integer, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Todas as tabelas vivem no schema "app". Ele e os papéis são criados pelo provisionamento
 * (infra/postgres/init em desenvolvimento), não pelas migrations.
 */
export const app = pgSchema("app");

/** Chave primária UUID v7 (ordenável por tempo), gerada no banco por app.uuid_v7(). */
export const pk = () =>
  uuid()
    .primaryKey()
    .default(sql`app.uuid_v7()`);

/** Dono da linha. Toda tabela de dados do aluno tem esta coluna: o RLS filtra por ela. */
export const ownerId = () => uuid().notNull();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Mantido pelo trigger app.set_updated_at(). */
export const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Controle de concorrência (If-Match). Incrementado pelo trigger app.bump_version(). */
export const version = () => integer().notNull().default(1);

/** Hashes (SHA-256) de tokens e corpos de requisição. O Drizzle não tem bytea nativo. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
