-- Backup automático (pg_dump) com um papel só de LEITURA: app_backup.
-- O papel é criado pelo provisionamento (sem login) e ganha login/senha em infra/prod/backup-role.sh.
-- Sob FORCE RLS nem o dono enxerga linhas sem contexto; a política backup_read libera SELECT a
-- app_backup em todas as tabelas. Nenhuma escrita: não há INSERT/UPDATE/DELETE para ele.
-- Tabela nova precisa da sua política backup_read (o teste security.int.test.ts confere).
GRANT USAGE ON SCHEMA app TO app_backup;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_backup;--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO app_backup;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT ON TABLES TO app_backup;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT ON SEQUENCES TO app_backup;--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE POLICY backup_read ON app.%I FOR SELECT TO app_backup USING (true)', t);
  END LOOP;
END
$$;
