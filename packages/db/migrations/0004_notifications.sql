-- Notificações (Fase 6): o worker passa a gerar lembretes de chamada e é acordado na hora em que
-- a API grava um alerta no outbox. Escrita à mão (drizzle-kit generate --custom). Roda como app_owner.

-- ---------------------------------------------------------------------------
-- 1. Outbox: avisa o worker assim que um envio é gravado (o NOTIFY só sai no COMMIT, então o
--    worker nunca vê uma linha de transação desfeita). A varredura periódica continua como rede
--    de segurança para quando o worker estava fora do ar.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.notify_outbox() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app
AS $$
BEGIN
  PERFORM pg_notify('presenca_outbox', '');
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER notification_logs_notify_outbox
  AFTER INSERT ON app.notification_logs
  FOR EACH STATEMENT EXECUTE FUNCTION app.notify_outbox();
--> statement-breakpoint

-- Contador de não lidas da central (consultado em toda página da área logada).
CREATE INDEX notification_logs_unread_idx ON app.notification_logs (user_id)
  WHERE channel = 'in_app' AND read_at IS NULL AND status = 'sent';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Worker: lembrete de chamada ("você tem aulas sem registro hoje").
--    Precisa inserir avisos e saber, por aluno, quais aulas da grade ficaram sem registro.
--    Só as colunas necessárias; nada de notas, motivos ou observações.
-- ---------------------------------------------------------------------------
GRANT INSERT ON app.notification_logs TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_insert ON app.notification_logs FOR INSERT TO app_worker WITH CHECK (true);
--> statement-breakpoint
-- Alerta por e-mail só para quem confirmou o endereço.
GRANT SELECT (email_verified_at) ON app.users TO app_worker;
--> statement-breakpoint
GRANT SELECT (id, user_id, status, starts_on, ends_on) ON app.semesters TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.semesters FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
GRANT SELECT (semester_id, archived_at) ON app.subjects TO app_worker;
--> statement-breakpoint
GRANT SELECT (id, user_id, subject_id, weekday, valid_from, valid_until)
  ON app.subject_schedules TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.subject_schedules FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
GRANT SELECT (user_id, subject_id, schedule_id, class_date) ON app.attendance_logs TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.attendance_logs FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
GRANT SELECT (semester_id, subject_id, kind, starts_on, ends_on)
  ON app.calendar_exceptions TO app_worker;
--> statement-breakpoint
CREATE POLICY worker_read ON app.calendar_exceptions FOR SELECT TO app_worker USING (true);
