-- Alerta de limite sem matéria: ao apagar a matéria (ou o semestre), a FK põe subject_id = NULL
-- (ON DELETE SET NULL) e a checagem antiga exigia subject_id, então a exclusão falhava com 500.
ALTER TABLE "app"."notification_logs" DROP CONSTRAINT "notification_logs_threshold_chk";--> statement-breakpoint
ALTER TABLE "app"."notification_logs" ADD CONSTRAINT "notification_logs_threshold_chk" CHECK ("app"."notification_logs"."kind" <> 'threshold' or coalesce("app"."notification_logs"."threshold_pct" in (50, 75, 90, 100) and "app"."notification_logs"."cycle" >= 1, false));