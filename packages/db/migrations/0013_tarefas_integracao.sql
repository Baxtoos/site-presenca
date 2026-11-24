CREATE TYPE "app"."task_source" AS ENUM('manual', 'moodle_ics', 'moodle_api');--> statement-breakpoint
CREATE TYPE "app"."task_status_source" AS ENUM('user', 'sync');--> statement-breakpoint
ALTER TABLE "app"."tasks" DROP CONSTRAINT "tasks_remind_chk";--> statement-breakpoint
ALTER TABLE "app"."tasks" ALTER COLUMN "remind_before_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "status_source" "app"."task_status_source" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "source" "app"."task_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "external_uid" text;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "external_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_external_uid_key" ON "app"."tasks" USING btree ("user_id","source","external_uid") WHERE "app"."tasks"."external_uid" is not null;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_external_url_chk" CHECK ("app"."tasks"."external_url" is null or ("app"."tasks"."external_url" ~ '^https://' and char_length("app"."tasks"."external_url") <= 2000));--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_external_uid_chk" CHECK (("app"."tasks"."source" = 'manual') = ("app"."tasks"."external_uid" is null) and ("app"."tasks"."external_uid" is null or char_length("app"."tasks"."external_uid") <= 500));--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_remind_chk" CHECK ("app"."tasks"."remind_before_minutes" is null or "app"."tasks"."remind_before_minutes" in (60, 180, 720, 1440, 2880));