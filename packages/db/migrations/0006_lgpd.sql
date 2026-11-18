-- LGPD (Fase 8): exclusão definitiva da conta do usuário autenticado.
-- A API não pode apagar eventos de auditoria diretamente (imutabilidade em uso normal), e um
-- modelo compartilhado pelo usuário pode ter sido importado por outros alunos (ON DELETE SET NULL
-- em subjects.source_template_id e ON DELETE CASCADE em template_imports.template_id).
-- Por isso a exclusão roda via função SECURITY DEFINER (app_owner), restrita a app.current_user_id(),
-- habilitando a política de cascata/limpeza apenas quando app.deleting_account = 'on'.

-- 1. Políticas de manutenção para app_owner sob FORCE RLS: só liberam leitura/exclusão quando
--    a variável de sessão app.deleting_account está ativa ('on'). Em consultas normais sem
--    contexto, nem app_owner enxerga linhas das tabelas.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'auth_accounts',
    'sessions',
    'auth_tokens',
    'semesters',
    'subjects',
    'subject_schedules',
    'calendar_exceptions',
    'attendance_logs',
    'attendance_log_events',
    'subject_threshold_state',
    'shared_templates',
    'template_imports',
    'notification_preferences',
    'push_subscriptions',
    'notification_logs',
    'idempotency_keys'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY owner_maintenance ON app.%I FOR ALL TO app_owner '
      'USING (current_setting(''app.deleting_account'', true) = ''on'') '
      'WITH CHECK (current_setting(''app.deleting_account'', true) = ''on'')',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- 2. Apaga a conta do usuário da transação atual (app.current_user_id()) e toda a sua trilha de auditoria.
CREATE FUNCTION app.delete_current_user()
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_uid uuid := app.current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.deleting_account', 'on', true);

  DELETE FROM app.users WHERE id = v_uid;
  IF NOT FOUND THEN
    PERFORM set_config('app.deleting_account', '', true);
    RETURN false;
  END IF;

  -- Apaga todos os eventos de auditoria do usuário, inclusive os 'delete' gerados pela cascata acima.
  DELETE FROM app.attendance_log_events WHERE user_id = v_uid;
  PERFORM set_config('app.deleting_account', '', true);
  RETURN true;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.delete_current_user() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.delete_current_user() TO app_api;
