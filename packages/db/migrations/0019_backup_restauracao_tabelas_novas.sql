-- Restauração do backup (infra/prod/restore-data.sh) grava como app_owner com
-- app.deleting_account = 'on', liberado pela política owner_maintenance (0006/0010). As tabelas
-- criadas depois (tarefas, Moodle, notas) ficaram sem ela e o ensaio de restauração falhava
-- ("new row violates row-level security policy"). Teste em security.int.test.ts impede de novo.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks',
    'moodle_connections',
    'moodle_course_mappings',
    'grading_schemes',
    'evaluation_items'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY owner_maintenance ON app.%I FOR ALL TO app_owner '
      'USING (current_setting(''app.deleting_account'', true) = ''on'') '
      'WITH CHECK (current_setting(''app.deleting_account'', true) = ''on'')',
      t);
  END LOOP;
END
$$;
