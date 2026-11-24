-- Segurança do conector do Moodle (o Drizzle não gera): FK composta com a matéria, triggers, RLS
-- forçado e permissões mínimas. O worker passa a gravar tarefas, mas só as importadas, e só de
-- quem tem a conexão ligada; nunca toca nas tarefas digitadas pelo aluno.

-- Matéria apagada: a turma fica sem matéria. SET NULL (coluna) zera só subject_id.
ALTER TABLE app.moodle_course_mappings
  ADD CONSTRAINT moodle_course_mappings_subject_owner_fk
  FOREIGN KEY (subject_id, user_id) REFERENCES app.subjects (id, user_id)
  ON DELETE SET NULL (subject_id);
--> statement-breakpoint

-- updated_at automático. A versão (If-Match) é incrementada pela API só nas mudanças do aluno:
-- a sincronização grava last_sync_at/last_seen_at sem invalidar a tela aberta.
CREATE TRIGGER moodle_connections_set_updated_at BEFORE UPDATE ON app.moodle_connections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER moodle_course_mappings_set_updated_at BEFORE UPDATE ON app.moodle_course_mappings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE app.moodle_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.moodle_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.moodle_course_mappings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.moodle_course_mappings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY api_owner_all ON app.moodle_connections FOR ALL TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY api_owner_all ON app.moodle_course_mappings FOR ALL TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY backup_read ON app.moodle_connections FOR SELECT TO app_backup USING (true);
--> statement-breakpoint
CREATE POLICY backup_read ON app.moodle_course_mappings FOR SELECT TO app_backup USING (true);
--> statement-breakpoint

REVOKE TRUNCATE, REFERENCES, TRIGGER ON app.moodle_connections FROM app_api;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON app.moodle_course_mappings FROM app_api;
--> statement-breakpoint

-- Worker: lê a conexão (credenciais cifradas; a chave só existe no processo) e grava o resultado.
REVOKE ALL ON app.moodle_connections FROM app_worker;
--> statement-breakpoint
GRANT SELECT (id, user_id, ics_url_enc, base_url, wstoken_enc, sync_enabled, next_sync_at)
  ON app.moodle_connections TO app_worker;
--> statement-breakpoint
GRANT UPDATE (last_sync_at, last_sync_error, next_sync_at) ON app.moodle_connections TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.moodle_connections FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
CREATE POLICY worker_update ON app.moodle_connections FOR UPDATE TO app_worker
  USING (sync_enabled) WITH CHECK (sync_enabled);
--> statement-breakpoint

-- Worker: registra turmas novas e quando foram vistas; não muda o vínculo escolhido pelo aluno.
REVOKE ALL ON app.moodle_course_mappings FROM app_worker;
--> statement-breakpoint
GRANT SELECT (id, user_id, course_key, subject_id, ignored)
  ON app.moodle_course_mappings TO app_worker;
--> statement-breakpoint
GRANT INSERT (user_id, course_key, subject_id, last_seen_at)
  ON app.moodle_course_mappings TO app_worker;
--> statement-breakpoint
GRANT UPDATE (last_seen_at) ON app.moodle_course_mappings TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.moodle_course_mappings FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
CREATE POLICY worker_insert ON app.moodle_course_mappings FOR INSERT TO app_worker
  WITH CHECK (EXISTS (
    SELECT 1 FROM app.moodle_connections c WHERE c.user_id = moodle_course_mappings.user_id
  ));
--> statement-breakpoint
CREATE POLICY worker_update ON app.moodle_course_mappings FOR UPDATE TO app_worker
  USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Worker: para casar turma e matéria pelo código (só matérias de semestres ativos).
GRANT SELECT (id, user_id, code) ON app.subjects TO app_worker;
--> statement-breakpoint

-- Worker: cria e atualiza só tarefas importadas, de quem tem a conexão ligada.
GRANT SELECT (source, external_uid, external_url, external_course_key, status_source, resolved_at)
  ON app.tasks TO app_worker;
--> statement-breakpoint
GRANT INSERT (user_id, subject_id, title, due_at, remind_before_minutes, status, status_source,
              resolved_at, source, external_uid, external_url, external_course_key)
  ON app.tasks TO app_worker;
--> statement-breakpoint
GRANT UPDATE (subject_id, title, due_at, status, status_source, resolved_at, external_url)
  ON app.tasks TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_sync_insert ON app.tasks FOR INSERT TO app_worker
  WITH CHECK (source <> 'manual' AND EXISTS (
    SELECT 1 FROM app.moodle_connections c WHERE c.user_id = tasks.user_id AND c.sync_enabled
  ));
--> statement-breakpoint
CREATE POLICY worker_sync_update ON app.tasks FOR UPDATE TO app_worker
  USING (source <> 'manual') WITH CHECK (source <> 'manual');
