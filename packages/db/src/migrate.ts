import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Pasta das migrations SQL; funciona tanto a partir de src/ quanto de dist/. */
export const MIGRATIONS_FOLDER = resolve(__dirname, "../migrations");

/**
 * Aplica as migrations pendentes. Precisa do papel dono do schema (app_owner).
 * O histórico fica em migrations.journal, fora do alcance da API.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: "presenca-migrate" });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: "migrations",
      migrationsTable: "journal",
    });
  } finally {
    await pool.end();
  }
}
