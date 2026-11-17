CREATE TYPE "app"."absence_reason" AS ENUM('health', 'work', 'transport', 'personal', 'other');--> statement-breakpoint
CREATE TYPE "app"."attendance_status" AS ENUM('present', 'absent', 'partial', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."audit_action" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "app"."checkin_mode" AS ENUM('off', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "app"."counting_mode" AS ENUM('class_count', 'workload', 'manual');--> statement-breakpoint
CREATE TYPE "app"."exception_kind" AS ENUM('holiday', 'no_classes', 'exam_week');--> statement-breakpoint
CREATE TYPE "app"."excused_policy" AS ENUM('track_only', 'deduct');--> statement-breakpoint
CREATE TYPE "app"."notification_channel" AS ENUM('email', 'push', 'in_app');--> statement-breakpoint
CREATE TYPE "app"."notification_kind" AS ENUM('threshold', 'checkin_reminder', 'system');--> statement-breakpoint
CREATE TYPE "app"."notification_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "app"."semester_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "app"."template_kind" AS ENUM('semester', 'subject');--> statement-breakpoint
CREATE TYPE "app"."token_purpose" AS ENUM('verify_email', 'reset_password', 'magic_link');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('active', 'disabled', 'pending_deletion');--> statement-breakpoint
CREATE TABLE "app"."auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_key" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "auth_accounts_provider_chk" CHECK ("app"."auth_accounts"."provider" in ('google'))
);
--> statement-breakpoint
CREATE TABLE "app"."auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"purpose" "app"."token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_expiry_chk" CHECK ("app"."auth_tokens"."expires_at" > "app"."auth_tokens"."created_at"),
	CONSTRAINT "auth_tokens_token_hash_len_chk" CHECK (octet_length("app"."auth_tokens"."token_hash") = 32),
	CONSTRAINT "auth_tokens_user_required_chk" CHECK ("app"."auth_tokens"."user_id" is not null or "app"."auth_tokens"."purpose" = 'magic_link')
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "sessions_expiry_chk" CHECK ("app"."sessions"."expires_at" > "app"."sessions"."created_at"),
	CONSTRAINT "sessions_token_hash_len_chk" CHECK (octet_length("app"."sessions"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"full_name" text NOT NULL,
	"institution" text,
	"course" text,
	"current_term" smallint,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"status" "app"."user_status" DEFAULT 'active' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_email_lower_chk" CHECK ("app"."users"."email" = lower("app"."users"."email")),
	CONSTRAINT "users_email_format_chk" CHECK ("app"."users"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	CONSTRAINT "users_full_name_chk" CHECK (char_length("app"."users"."full_name") between 1 and 120),
	CONSTRAINT "users_current_term_chk" CHECK ("app"."users"."current_term" between 1 and 20),
	CONSTRAINT "users_timezone_chk" CHECK (char_length("app"."users"."timezone") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "app"."calendar_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"kind" "app"."exception_kind" NOT NULL,
	"subject_id" uuid,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_exceptions_dates_chk" CHECK ("app"."calendar_exceptions"."ends_on" >= "app"."calendar_exceptions"."starts_on"),
	CONSTRAINT "calendar_exceptions_label_chk" CHECK (char_length("app"."calendar_exceptions"."label") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "app"."semesters" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "app"."semester_status" DEFAULT 'active' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semesters_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "semesters_user_label_key" UNIQUE("user_id","label"),
	CONSTRAINT "semesters_dates_chk" CHECK ("app"."semesters"."ends_on" > "app"."semesters"."starts_on"),
	CONSTRAINT "semesters_label_chk" CHECK (char_length("app"."semesters"."label") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "app"."subject_schedules" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"units" smallint DEFAULT 1 NOT NULL,
	"room" text,
	"building" text,
	"professor" text,
	"valid_from" date,
	"valid_until" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_schedules_id_subject_key" UNIQUE("id","subject_id"),
	CONSTRAINT "subject_schedules_weekday_chk" CHECK ("app"."subject_schedules"."weekday" between 1 and 7),
	CONSTRAINT "subject_schedules_time_chk" CHECK ("app"."subject_schedules"."ends_at" > "app"."subject_schedules"."starts_at"),
	CONSTRAINT "subject_schedules_units_chk" CHECK ("app"."subject_schedules"."units" between 1 and 6),
	CONSTRAINT "subject_schedules_validity_chk" CHECK ("app"."subject_schedules"."valid_from" is null or "app"."subject_schedules"."valid_until" is null or "app"."subject_schedules"."valid_until" >= "app"."subject_schedules"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "app"."subjects" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"professor" text,
	"color" text,
	"counting_mode" "app"."counting_mode" NOT NULL,
	"total_classes" smallint,
	"units_per_class" smallint DEFAULT 1 NOT NULL,
	"workload_hours" numeric(6, 2),
	"workload_hour_minutes" smallint,
	"unit_minutes" smallint,
	"min_attendance_bp" smallint DEFAULT 7500 NOT NULL,
	"manual_max_units" smallint,
	"excused_policy" "app"."excused_policy" DEFAULT 'track_only' NOT NULL,
	"source_template_id" uuid,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "subjects_name_chk" CHECK (char_length("app"."subjects"."name") between 1 and 120),
	CONSTRAINT "subjects_units_per_class_chk" CHECK ("app"."subjects"."units_per_class" between 1 and 6),
	CONSTRAINT "subjects_min_attendance_chk" CHECK ("app"."subjects"."min_attendance_bp" between 0 and 10000),
	CONSTRAINT "subjects_mode_fields_chk" CHECK (coalesce(case "app"."subjects"."counting_mode"
        when 'class_count' then "app"."subjects"."total_classes" > 0
        when 'workload' then "app"."subjects"."workload_hours" > 0 and "app"."subjects"."workload_hour_minutes" in (45, 50, 60)
                             and "app"."subjects"."unit_minutes" between 10 and 240
        when 'manual' then "app"."subjects"."manual_max_units" >= 0
      end, false)),
	CONSTRAINT "subjects_total_classes_chk" CHECK ("app"."subjects"."total_classes" is null or "app"."subjects"."total_classes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."attendance_log_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."attendance_log_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"log_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "app"."audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."attendance_logs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"schedule_id" uuid,
	"class_date" date NOT NULL,
	"status" "app"."attendance_status" NOT NULL,
	"units_scheduled" smallint NOT NULL,
	"units_missed" smallint NOT NULL,
	"is_excused" boolean DEFAULT false NOT NULL,
	"reason" "app"."absence_reason",
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_logs_one_per_occurrence" UNIQUE NULLS NOT DISTINCT("subject_id","class_date","schedule_id"),
	CONSTRAINT "attendance_logs_units_scheduled_chk" CHECK ("app"."attendance_logs"."units_scheduled" between 1 and 6),
	CONSTRAINT "attendance_logs_status_units_chk" CHECK (("app"."attendance_logs"."status" = 'present' and "app"."attendance_logs"."units_missed" = 0)
       or ("app"."attendance_logs"."status" = 'absent' and "app"."attendance_logs"."units_missed" = "app"."attendance_logs"."units_scheduled")
       or ("app"."attendance_logs"."status" = 'partial' and "app"."attendance_logs"."units_missed" between 1 and "app"."attendance_logs"."units_scheduled" - 1)
       or ("app"."attendance_logs"."status" = 'cancelled' and "app"."attendance_logs"."units_missed" = 0 and not "app"."attendance_logs"."is_excused")),
	CONSTRAINT "attendance_logs_excused_chk" CHECK (not "app"."attendance_logs"."is_excused" or "app"."attendance_logs"."status" in ('absent', 'partial')),
	CONSTRAINT "attendance_logs_note_chk" CHECK (char_length("app"."attendance_logs"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "app"."subject_threshold_state" (
	"subject_id" uuid NOT NULL,
	"threshold_pct" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	"armed" boolean DEFAULT true NOT NULL,
	"cycle" integer DEFAULT 0 NOT NULL,
	"last_crossed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_threshold_state_pk" PRIMARY KEY("subject_id","threshold_pct"),
	CONSTRAINT "subject_threshold_state_pct_chk" CHECK ("app"."subject_threshold_state"."threshold_pct" in (50, 75, 90, 100)),
	CONSTRAINT "subject_threshold_state_cycle_chk" CHECK ("app"."subject_threshold_state"."cycle" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."shared_templates" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "app"."template_kind" NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"institution" text,
	"course" text,
	"payload" jsonb NOT NULL,
	"payload_version" smallint DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_templates_code_key" UNIQUE("code"),
	CONSTRAINT "shared_templates_code_chk" CHECK ("app"."shared_templates"."code" ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
	CONSTRAINT "shared_templates_title_chk" CHECK (char_length("app"."shared_templates"."title") between 1 and 120),
	CONSTRAINT "shared_templates_uses_chk" CHECK ("app"."shared_templates"."uses_count" >= 0 and ("app"."shared_templates"."max_uses" is null or "app"."shared_templates"."max_uses" > 0))
);
--> statement-breakpoint
CREATE TABLE "app"."template_imports" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_semester_id" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid,
	"kind" "app"."notification_kind" NOT NULL,
	"channel" "app"."notification_channel" NOT NULL,
	"threshold_pct" smallint,
	"cycle" integer,
	"dedupe_key" text NOT NULL,
	"status" "app"."notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_logs_dedupe_key" UNIQUE("dedupe_key","channel"),
	CONSTRAINT "notification_logs_threshold_chk" CHECK ("app"."notification_logs"."kind" <> 'threshold' or coalesce("app"."notification_logs"."threshold_pct" in (50, 75, 90, 100) and "app"."notification_logs"."cycle" >= 1 and "app"."notification_logs"."subject_id" is not null, false)),
	CONSTRAINT "notification_logs_attempts_chk" CHECK ("app"."notification_logs"."attempts" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "app"."notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"thresholds" smallint[] DEFAULT '{50,75,90,100}'::smallint[] NOT NULL,
	"checkin_reminder" "app"."checkin_mode" DEFAULT 'off' NOT NULL,
	"checkin_time" time DEFAULT '21:00' NOT NULL,
	"checkin_weekday" smallint DEFAULT 5 NOT NULL,
	"quiet_start" time,
	"quiet_end" time,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_thresholds_chk" CHECK ("app"."notification_preferences"."thresholds" <@ '{50,75,90,100}'::smallint[]),
	CONSTRAINT "notification_preferences_weekday_chk" CHECK ("app"."notification_preferences"."checkin_weekday" between 1 and 7),
	CONSTRAINT "notification_preferences_quiet_chk" CHECK (("app"."notification_preferences"."quiet_start" is null) = ("app"."notification_preferences"."quiet_end" is null))
);
--> statement-breakpoint
CREATE TABLE "app"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_chk" CHECK ("app"."push_subscriptions"."endpoint" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "app"."idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"status_code" smallint NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "idempotency_keys_key_chk" CHECK (char_length("app"."idempotency_keys"."key") between 8 and 128),
	CONSTRAINT "idempotency_keys_status_chk" CHECK ("app"."idempotency_keys"."status_code" between 200 and 599)
);
--> statement-breakpoint
ALTER TABLE "app"."auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_semester_owner_fk" FOREIGN KEY ("semester_id","user_id") REFERENCES "app"."semesters"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."semesters" ADD CONSTRAINT "semesters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subject_schedules" ADD CONSTRAINT "subject_schedules_subject_owner_fk" FOREIGN KEY ("subject_id","user_id") REFERENCES "app"."subjects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subjects" ADD CONSTRAINT "subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subjects" ADD CONSTRAINT "subjects_semester_owner_fk" FOREIGN KEY ("semester_id","user_id") REFERENCES "app"."semesters"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."attendance_logs" ADD CONSTRAINT "attendance_logs_subject_owner_fk" FOREIGN KEY ("subject_id","user_id") REFERENCES "app"."subjects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subject_threshold_state" ADD CONSTRAINT "subject_threshold_state_subject_owner_fk" FOREIGN KEY ("subject_id","user_id") REFERENCES "app"."subjects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shared_templates" ADD CONSTRAINT "shared_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."template_imports" ADD CONSTRAINT "template_imports_template_id_shared_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."shared_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."template_imports" ADD CONSTRAINT "template_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_logs" ADD CONSTRAINT "notification_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "app"."auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "app"."auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_idx" ON "app"."auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "app"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "app"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "calendar_exceptions_semester_idx" ON "app"."calendar_exceptions" USING btree ("semester_id","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "semesters_one_current_idx" ON "app"."semesters" USING btree ("user_id") WHERE "app"."semesters"."is_current";--> statement-breakpoint
CREATE INDEX "subject_schedules_user_weekday_idx" ON "app"."subject_schedules" USING btree ("user_id","weekday");--> statement-breakpoint
CREATE INDEX "subject_schedules_subject_idx" ON "app"."subject_schedules" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "subjects_user_semester_idx" ON "app"."subjects" USING btree ("user_id","semester_id");--> statement-breakpoint
CREATE INDEX "attendance_log_events_log_idx" ON "app"."attendance_log_events" USING btree ("log_id","at");--> statement-breakpoint
CREATE INDEX "attendance_log_events_user_idx" ON "app"."attendance_log_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "attendance_logs_subject_date_idx" ON "app"."attendance_logs" USING btree ("subject_id","class_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attendance_logs_user_date_idx" ON "app"."attendance_logs" USING btree ("user_id","class_date");--> statement-breakpoint
CREATE INDEX "shared_templates_owner_idx" ON "app"."shared_templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "template_imports_template_idx" ON "app"."template_imports" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_imports_user_idx" ON "app"."template_imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_logs_user_idx" ON "app"."notification_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_logs_due_idx" ON "app"."notification_logs" USING btree ("scheduled_for") WHERE "app"."notification_logs"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "app"."push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "app"."idempotency_keys" USING btree ("created_at");