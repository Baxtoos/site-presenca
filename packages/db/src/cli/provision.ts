// Prepara os papéis e o schema num banco gerenciado (Neon etc.):
//   ADMIN_DATABASE_URL="postgres://dono:senha@host/banco?sslmode=require" pnpm db:provision
// Senhas opcionais (senão são geradas): APP_OWNER_PASSWORD, APP_API_PASSWORD, APP_WORKER_PASSWORD.
// Pode rodar de novo para trocar as senhas.
import { provisionRoles } from "../provision";

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) {
  console.error(
    "Defina ADMIN_DATABASE_URL com a conexão do dono do banco (a que o provedor mostra).",
  );
  process.exit(1);
}

provisionRoles({
  adminUrl,
  passwords: {
    app_owner: process.env.APP_OWNER_PASSWORD || undefined,
    app_api: process.env.APP_API_PASSWORD || undefined,
    app_worker: process.env.APP_WORKER_PASSWORD || undefined,
  },
})
  .then((result) => {
    console.log(`Papéis prontos no banco "${result.database}".\n`);
    if (result.generated.length < 3) {
      console.log(`Senhas geradas agora: ${result.generated.join(", ") || "nenhuma"}.\n`);
    }
    console.log("Guarde estas linhas num cofre/gerenciador de senhas (NÃO commite):\n");
    console.log(`DATABASE_URL_OWNER=${result.urls.app_owner}   # só para as migrations`);
    console.log(`DATABASE_URL=${result.urls.app_api}   # API`);
    console.log(`WORKER_DATABASE_URL=${result.urls.app_worker}   # worker`);
    console.log("\nPróximo passo: DATABASE_URL_OWNER=... pnpm db:migrate");
  })
  .catch((error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
    console.error("Falha ao preparar o banco (nada foi alterado):");
    console.error(cause?.message ?? (error instanceof Error ? error.message : error));
    process.exit(1);
  });
