CREATE TYPE "app"."task_status" AS ENUM('pending', 'completed', 'not_completed');--> statement-breakpoint
ALTER TYPE "app"."notification_kind" ADD VALUE 'task_due';--> statement-breakpoint
CREATE TABLE "app"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp with time zone NOT NULL,
	"remind_before_minutes" integer DEFAULT 1440 NOT NULL,
	"status" "app"."task_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "tasks_title_chk" CHECK (char_length(btrim("app"."tasks"."title")) between 1 and 200),
	CONSTRAINT "tasks_notes_chk" CHECK ("app"."tasks"."notes" is null or char_length("app"."tasks"."notes") <= 2000),
	CONSTRAINT "tasks_remind_chk" CHECK ("app"."tasks"."remind_before_minutes" in (60, 180, 720, 1440, 2880)),
	CONSTRAINT "tasks_resolved_chk" CHECK (("app"."tasks"."status" = 'pending') = ("app"."tasks"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "app"."notification_logs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_user_due_idx" ON "app"."tasks" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "tasks_pending_due_idx" ON "app"."tasks" USING btree ("due_at") WHERE "app"."tasks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_logs_task_pending_idx" ON "app"."notification_logs" USING btree ("task_id") WHERE "app"."notification_logs"."status" in ('pending', 'failed');