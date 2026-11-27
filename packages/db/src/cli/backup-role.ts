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
