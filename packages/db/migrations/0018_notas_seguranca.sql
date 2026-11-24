-- Segurança das notas (o Drizzle não gera): FKs compostas, triggers, RLS forçado e permissões. Não
-- cita o valor novo 'grade_posted' de notification_kind (o migrador roda tudo numa transação só).

-- Regra e avaliações pertencem à matéria do mesmo aluno; apagar a matéria apaga as duas.
ALTER TABLE app.grading_schemes
  ADD CONSTRAINT grading_schemes_subject_owner_fk
  FOREIGN KEY (subject_id, user_id) REFERENCES app.subjects (id, user_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE app.evaluation_items
  ADD CONSTRAINT evaluation_items_subject_owner_fk
  FOREIGN KEY (subject_id, user_id) REFERENCES app.subjects (id, user_id) ON DELETE CASCADE;
--> statement-breakpoint

-- Tarefa ligada a uma avaliação do mesmo aluno; apagar a avaliação só desliga a tarefa.
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_evaluation_owner_fk
  FOREIGN KEY (evaluation_item_id, user_id) REFERENCES app.evaluation_items (id, user_id)
  ON DELETE SET NULL (evaluation_item_id);
--> statement-breakpoint

-- E da mesma matéria: ligar a uma avaliação de outra matéria é recusado; se a matéria da tarefa
-- mudar (ou for apagada), a ligação se desfaz sozinha em vez de travar a operação.
CREATE FUNCTION app.tasks_evaluation_same_subject() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evaluation_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.evaluation_items e
     WHERE e.id = NEW.evaluation_item_id AND e.subject_id IS NOT DISTINCT FROM NEW.subject_id
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.evaluation_item_id IS DISTINCT FROM OLD.evaluation_item_id THEN
    RAISE EXCEPTION 'a avaliação precisa ser da mesma matéria da tarefa'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_evaluation_subject_chk';
  END IF;
  NEW.evaluation_item_id := NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tasks_evaluation_same_subject BEFORE INSERT OR UPDATE OF evaluation_item_id, subject_id
  ON app.tasks FOR EACH ROW EXECUTE FUNCTION app.tasks_evaluation_same_subject();
--> statement-breakpoint

CREATE TRIGGER grading_schemes_set_updated_at BEFORE UPDATE ON app.grading_schemes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER grading_schemes_bump_version BEFORE UPDATE ON app.grading_schemes
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint
CREATE TRIGGER evaluation_items_set_updated_at BEFORE UPDATE ON app.evaluation_items
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER evaluation_items_bump_version BEFORE UPDATE ON app.evaluation_items
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();
--> statement-breakpoint

ALTER TABLE app.grading_schemes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.grading_schemes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.evaluation_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.evaluation_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_owner_all ON app.grading_schemes FOR ALL TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY api_owner_all ON app.evaluation_items FOR ALL TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY backup_read ON app.grading_schemes FOR SELECT TO app_backup USING (true);
--> statement-breakpoint
CREATE POLICY backup_read ON app.evaluation_items FOR SELECT TO app_backup USING (true);
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON app.grading_schemes FROM app_api;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON app.evaluation_items FROM app_api;
--> statement-breakpoint

-- Worker: não vê a regra de cálculo.
REVOKE ALL ON app.grading_schemes FROM app_worker;
--> statement-breakpoint
-- Worker: importa notas do Moodle só em avaliações ligadas a um item do Moodle e nunca por cima
-- de nota lançada pelo aluno (score_source = 'user'). Também lê (id, matéria) para a checagem da
-- mesma matéria quando a sincronização mexe na matéria de uma tarefa.
REVOKE ALL ON app.evaluation_items FROM app_worker;
--> statement-breakpoint
GRANT SELECT (id, user_id, subject_id, key, name, max_score, score, score_source,
              external_grade_item_id)
  ON app.evaluation_items TO app_worker;
--> statement-breakpoint
GRANT UPDATE (score, score_source, scored_at) ON app.evaluation_items TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.evaluation_items FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
CREATE POLICY worker_moodle_scores ON app.evaluation_items FOR UPDATE TO app_worker
  USING (external_grade_item_id IS NOT NULL AND score_source = 'moodle')
  WITH CHECK (external_grade_item_id IS NOT NULL AND score_source = 'moodle');
--> statement-breakpoint
GRANT SELECT (evaluation_item_id) ON app.tasks TO app_worker;
