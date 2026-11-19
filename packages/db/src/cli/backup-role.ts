// Dá login ao papel de backup (só leitura) num banco gerenciado, sem trocar as outras senhas:
//   ADMIN_DATABASE_URL="postgres://dono:senha@host/banco?sslmode=require" pnpm db:backup-role
// Senha opcional (senão é gerada): APP_BACKUP_PASSWORD. Rode `pnpm db:migrate` depois (0008).
import { provisionBackupRole } from "../provision";

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) {
  console.error("Defina ADMIN_DATABASE_URL com a conexão do dono do banco.");
  process.exit(1);
}

provisionBackupRole({ adminUrl, password: process.env.APP_BACKUP_PASSWORD || undefined })
  .then((url) => {
    console.log(`BACKUP_DATABASE_URL=${url}`);
  })
  .catch((error: unknown) => {
    console.error("Falha ao preparar o papel de backup (nada foi alterado):");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
