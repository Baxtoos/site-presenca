import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Todas as tabelas vivem no schema "app" (criado em infra/postgres/init).
 * As tabelas, a view subject_totals, o RLS e os triggers chegam na Fase 1.
 */
export const app = pgSchema("app");
