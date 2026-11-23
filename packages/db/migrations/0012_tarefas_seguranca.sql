-- Segurança das tarefas (o Drizzle não gera): FKs compostas com SET NULL por coluna, triggers,
-- RLS forçado e permissões mínimas. Não cita o valor novo 'task_due' do enum notification_kind:
-- o migrador roda as migrations pendentes numa transação só, e o Postgres não deixa usar um valor
-- de enum na mesma transação que o criou.

-- Matéria apagada: a tarefa fica, sem matéria. SET NULL (coluna) zera só subject_id, nunca user_id.
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_subject_owner_fk
  FOREIGN KEY (subject_id, user_id) REFERENCES app.subjects (id, user_id)
  ON DELETE SET NULL (subject_id);
--> statement-breakpoint

-- Aviso de tarefa apagada fica no histórico (o título está no payload).
ALTER TABLE app.notification_logs
  ADD CONSTRAINT notification_logs_task_owner_fk
  FOREIGN KEY (task_id, user_id) REFERENCES app.tasks (id, user_id)
  ON DELETE SET NULL (task_id);
--> statement-breakpoint

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tasks_bump_version BEFORE UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint

ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_owner_all ON app.tasks FOR ALL TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY backup_read ON app.tasks FOR SELECT TO app_backup USING (true);
--> statement-breakpoint

-- API: só SELECT/INSERT/UPDATE/DELETE (o provisionamento dá DML em todas as tabelas).
REVOKE TRUNCATE, REFERENCES, TRIGGER ON app.tasks FROM app_api;
--> statement-breakpoint

-- Worker: lê só o necessário para gerar e revalidar o aviso; não escreve na tabela.
REVOKE ALL ON app.tasks FROM app_worker;
--> statement-breakpoint
GRANT SELECT (id, user_id, subject_id, title, due_at, remind_before_minutes, status)
  ON app.tasks TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.tasks FOR SELECT TO app_worker USING (true);
