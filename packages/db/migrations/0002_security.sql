-- Segurança e integridade que o Drizzle não gera: FKs compostas com SET NULL por coluna,
-- view de totais, triggers e Row-Level Security forçado.
-- Escrita à mão (drizzle-kit generate --custom). Roda como app_owner.

-- ---------------------------------------------------------------------------
-- 1. FKs compostas: o filho sempre pertence ao mesmo dono do pai.
--    "ON DELETE SET NULL (coluna)" (Postgres 15+) zera só a referência, não o user_id.
-- ---------------------------------------------------------------------------

-- O horário precisa ser da mesma matéria do registro.
ALTER TABLE app.attendance_logs
  ADD CONSTRAINT attendance_logs_schedule_subject_fk
  FOREIGN KEY (schedule_id, subject_id) REFERENCES app.subject_schedules (id, subject_id)
  ON DELETE SET NULL (schedule_id);
--> statement-breakpoint
CREATE INDEX attendance_logs_schedule_idx ON app.attendance_logs (schedule_id);
--> statement-breakpoint

ALTER TABLE app.calendar_exceptions
  ADD CONSTRAINT calendar_exceptions_subject_owner_fk
  FOREIGN KEY (subject_id, user_id) REFERENCES app.subjects (id, user_id)
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE app.notification_logs
  ADD CONSTRAINT notification_logs_subject_owner_fk
  FOREIGN KEY (subject_id, user_id) REFERENCES app.subjects (id, user_id)
  ON DELETE SET NULL (subject_id);
--> statement-breakpoint

ALTER TABLE app.template_imports
  ADD CONSTRAINT template_imports_semester_owner_fk
  FOREIGN KEY (created_semester_id, user_id) REFERENCES app.semesters (id, user_id)
  ON DELETE SET NULL (created_semester_id);
--> statement-breakpoint

-- Referência informativa: o modelo pode ser de outra pessoa (é o propósito do compartilhamento).
ALTER TABLE app.subjects
  ADD CONSTRAINT subjects_source_template_fk
  FOREIGN KEY (source_template_id) REFERENCES app.shared_templates (id)
  ON DELETE SET NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Totais de faltas: sempre derivados dos registros, nunca armazenados.
--    security_invoker = true: a view respeita o RLS de quem consulta.
-- ---------------------------------------------------------------------------
CREATE VIEW app.subject_totals WITH (security_invoker = true) AS
SELECT
  s.id AS subject_id,
  s.user_id,
  coalesce(sum(l.units_missed) FILTER (
    WHERE l.status IN ('absent', 'partial')
      AND (NOT l.is_excused OR s.excused_policy = 'track_only')
  ), 0)::integer AS units_counted,
  coalesce(sum(l.units_missed) FILTER (WHERE l.is_excused), 0)::integer AS units_excused,
  coalesce(sum(l.units_scheduled) FILTER (WHERE l.status <> 'cancelled'), 0)::integer AS units_held,
  count(l.id) AS logs_count
FROM app.subjects s
LEFT JOIN app.attendance_logs l ON l.subject_id = s.id
GROUP BY s.id, s.user_id;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Triggers de manutenção.
-- ---------------------------------------------------------------------------
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER semesters_set_updated_at BEFORE UPDATE ON app.semesters
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subjects_set_updated_at BEFORE UPDATE ON app.subjects
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subject_schedules_set_updated_at BEFORE UPDATE ON app.subject_schedules
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attendance_logs_set_updated_at BEFORE UPDATE ON app.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subject_threshold_state_set_updated_at BEFORE UPDATE ON app.subject_threshold_state
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON app.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

CREATE TRIGGER semesters_bump_version BEFORE UPDATE ON app.semesters
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint
CREATE TRIGGER subjects_bump_version BEFORE UPDATE ON app.subjects
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint
CREATE TRIGGER subject_schedules_bump_version BEFORE UPDATE ON app.subject_schedules
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint
CREATE TRIGGER attendance_logs_bump_version BEFORE UPDATE ON app.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint

-- Auditoria: toda criação, edição e exclusão de registro de presença gera um evento.
-- SECURITY DEFINER (roda como app_owner) porque a API não tem permissão de escrever eventos.
-- Obs.: a exclusão de conta (Fase 8) apaga os eventos do usuário explicitamente.
CREATE FUNCTION app.audit_attendance_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  req text := nullif(current_setting('app.request_id', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app.attendance_log_events (log_id, user_id, action, before, after, request_id)
    VALUES (NEW.id, NEW.user_id, 'insert', NULL, to_jsonb(NEW), req);
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO app.attendance_log_events (log_id, user_id, action, before, after, request_id)
    VALUES (NEW.id, NEW.user_id, 'update', to_jsonb(OLD), to_jsonb(NEW), req);
  ELSE
    INSERT INTO app.attendance_log_events (log_id, user_id, action, before, after, request_id)
    VALUES (OLD.id, OLD.user_id, 'delete', to_jsonb(OLD), NULL, req);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.audit_attendance_log() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER attendance_logs_audit AFTER INSERT OR UPDATE OR DELETE ON app.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION app.audit_attendance_log();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security forçado em todas as tabelas (vale até para o dono).
--    A API (app_api) só enxerga linhas do usuário definido em app.user_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('users', 'id'),
      ('auth_accounts', 'user_id'),
      ('sessions', 'user_id'),
      ('auth_tokens', 'user_id'),
      ('semesters', 'user_id'),
      ('subjects', 'user_id'),
      ('subject_schedules', 'user_id'),
      ('calendar_exceptions', 'user_id'),
      ('attendance_logs', 'user_id'),
      ('attendance_log_events', 'user_id'),
      ('subject_threshold_state', 'user_id'),
      ('shared_templates', 'owner_id'),
      ('template_imports', 'user_id'),
      ('notification_preferences', 'user_id'),
      ('push_subscriptions', 'user_id'),
      ('notification_logs', 'user_id'),
      ('idempotency_keys', 'user_id')
    ) AS v(tbl, col)
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t.tbl);
    IF t.tbl = 'attendance_log_events' THEN
      -- Eventos: a API só lê os próprios.
      EXECUTE format(
        'CREATE POLICY api_owner_read ON app.%I FOR SELECT TO app_api USING (%I = app.current_user_id())',
        t.tbl, t.col);
    ELSE
      EXECUTE format(
        'CREATE POLICY api_owner_all ON app.%I FOR ALL TO app_api '
        'USING (%I = app.current_user_id()) WITH CHECK (%I = app.current_user_id())',
        t.tbl, t.col, t.col);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- O trigger de auditoria roda como app_owner, que também está sujeito ao RLS forçado.
CREATE POLICY audit_trigger_insert ON app.attendance_log_events
  FOR INSERT TO app_owner WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Permissões finas da API (as padrão vêm do provisionamento: DML em todas as tabelas).
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.attendance_log_events FROM app_api;
--> statement-breakpoint
REVOKE ALL ON app.subject_totals FROM app_api;
--> statement-breakpoint
GRANT SELECT ON app.subject_totals TO app_api;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA app FROM app_api;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Worker: acesso entre usuários, mas só ao que envia notificações e limpa dados expirados.
-- ---------------------------------------------------------------------------
GRANT SELECT, UPDATE ON app.notification_logs TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.notification_logs FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
CREATE POLICY worker_update ON app.notification_logs FOR UPDATE TO app_worker USING (true) WITH CHECK (true);
--> statement-breakpoint

GRANT SELECT, UPDATE, DELETE ON app.push_subscriptions TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_all ON app.push_subscriptions FOR ALL TO app_worker USING (true) WITH CHECK (true);
--> statement-breakpoint

GRANT SELECT ON app.notification_preferences TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.notification_preferences FOR SELECT TO app_worker USING (true);
--> statement-breakpoint

-- Só as colunas necessárias para endereçar e personalizar a mensagem (nada de hash de senha).
GRANT SELECT (id, email, full_name, timezone, status) ON app.users TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.users FOR SELECT TO app_worker USING (true);
--> statement-breakpoint

GRANT SELECT (id, user_id, name) ON app.subjects TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.subjects FOR SELECT TO app_worker USING (true);
--> statement-breakpoint

-- Limpeza agendada de dados expirados.
GRANT SELECT (id, expires_at, revoked_at), DELETE ON app.sessions TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_cleanup ON app.sessions FOR ALL TO app_worker USING (true);
--> statement-breakpoint
GRANT SELECT (id, expires_at, used_at), DELETE ON app.auth_tokens TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_cleanup ON app.auth_tokens FOR ALL TO app_worker USING (true);
--> statement-breakpoint
GRANT SELECT (user_id, key, created_at), DELETE ON app.idempotency_keys TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_cleanup ON app.idempotency_keys FOR ALL TO app_worker USING (true);
