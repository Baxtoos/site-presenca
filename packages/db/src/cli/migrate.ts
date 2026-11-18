// Passo de migration do deploy:  node dist/cli/migrate.js   (usa DATABASE_URL_OWNER)
import { resolve } from "node:path";
import { runMigrations } from "../migrate";

if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(resolve(__dirname, "../../../../.env"));
  } catch {
    // sem .env: usa o ambiente
  }
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error("DATABASE_URL_OWNER não definida: as migrations rodam com o papel app_owner.");
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log("Migrations aplicadas."))
  .catch((error: unknown) => {
    // O Drizzle embrulha o erro do Postgres em `cause`; o motivo real está lá.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
    console.error("Falha ao aplicar migrations (nada foi aplicado: tudo roda numa transação).");
    console.error("Motivo:", cause?.message ?? (error instanceof Error ? error.message : error));
    process.exit(1);
  });
