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
    // O Drizzle embrulha o erro do Postgres em `cause`; o motivo real está lá. Queda de conexão
    // chega como AggregateError sem texto: mostra o código (ECONNREFUSED, ETIMEDOUT...) de cada
    // tentativa. Nunca imprime a URL (tem a senha).
    const root = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const parts = (e: unknown): string[] => {
      if (!(e instanceof Error)) return [String(e)];
      const code = (e as NodeJS.ErrnoException).code;
      const inner = e instanceof AggregateError ? e.errors.flatMap(parts) : [];
      const own = [e.message, code].filter(Boolean).join(" ");
      return [own || e.name, ...inner];
    };
    console.error("Falha ao aplicar migrations (nada foi aplicado: tudo roda numa transação).");
    console.error("Motivo:", [...new Set(parts(root))].join(" | "));
    process.exit(1);
  });
