import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Migrations rodam com o papel dono do schema (app_owner), nunca com o papel da API.
try {
  process.loadEnvFile(resolve(__dirname, "../../.env"));
} catch {
  // sem .env: usa as variáveis já definidas no ambiente (CI, deploy)
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER não definida (veja .env.example)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["app"],
  dbCredentials: { url },
  migrations: { schema: "app", table: "__migrations" },
  strict: true,
  verbose: true,
});
