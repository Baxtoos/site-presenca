-- "Não teve chamada": a aula aconteceu sem chamada (conta como dada, sem falta). O check compara
-- status::text porque o Postgres não deixa usar o valor novo do enum na mesma transação que o cria.
ALTER TYPE "app"."attendance_status" ADD VALUE 'no_call';--> statement-breakpoint
ALTER TABLE "app"."attendance_logs" DROP CONSTRAINT "attendance_logs_status_units_chk";--> statement-breakpoint
ALTER TABLE "app"."attendance_logs" ADD CONSTRAINT "attendance_logs_status_units_chk" CHECK (("app"."attendance_logs"."status" = 'present' and "app"."attendance_logs"."units_missed" = 0)
       or ("app"."attendance_logs"."status" = 'absent' and "app"."attendance_logs"."units_missed" = "app"."attendance_logs"."units_scheduled")
       or ("app"."attendance_logs"."status" = 'partial' and "app"."attendance_logs"."units_missed" between 1 and "app"."attendance_logs"."units_scheduled" - 1)
       or ("app"."attendance_logs"."status" = 'cancelled' and "app"."attendance_logs"."units_missed" = 0 and not "app"."attendance_logs"."is_excused")
       or ("app"."attendance_logs"."status"::text = 'no_call' and "app"."attendance_logs"."units_missed" = 0 and not "app"."attendance_logs"."is_excused"));