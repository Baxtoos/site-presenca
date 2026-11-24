ALTER TYPE "app"."notification_kind" ADD VALUE 'grade_posted';--> statement-breakpoint
CREATE TABLE "app"."evaluation_items" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"max_score" integer NOT NULL,
	"group_key" text,
	"role" text DEFAULT 'regular' NOT NULL,
	"due_on" date,
	"score" integer,
	"score_source" text DEFAULT 'user' NOT NULL,
	"scored_at" timestamp with time zone,
	"external_grade_item_id" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_items_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "evaluation_items_key_chk" CHECK (char_length("app"."evaluation_items"."key") between 1 and 30),
	CONSTRAINT "evaluation_items_name_chk" CHECK (char_length(btrim("app"."evaluation_items"."name")) between 1 and 120),
	CONSTRAINT "evaluation_items_max_chk" CHECK ("app"."evaluation_items"."max_score" between 1 and 10000),
	CONSTRAINT "evaluation_items_score_chk" CHECK ("app"."evaluation_items"."score" is null or "app"."evaluation_items"."score" between 0 and "app"."evaluation_items"."max_score"),
	CONSTRAINT "evaluation_items_role_chk" CHECK ("app"."evaluation_items"."role" in ('regular', 'substitute', 'exam')),
	CONSTRAINT "evaluation_items_source_chk" CHECK ("app"."evaluation_items"."score_source" in ('user', 'moodle')),
	CONSTRAINT "evaluation_items_scored_chk" CHECK (("app"."evaluation_items"."score" is null) = ("app"."evaluation_items"."scored_at" is null)),
	CONSTRAINT "evaluation_items_external_chk" CHECK ("app"."evaluation_items"."external_grade_item_id" is null or char_length("app"."evaluation_items"."external_grade_item_id") <= 100)
);
--> statement-breakpoint
CREATE TABLE "app"."grading_schemes" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"rules" jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_schemes_subject_key" UNIQUE("subject_id"),
	CONSTRAINT "grading_schemes_rules_chk" CHECK (jsonb_typeof("app"."grading_schemes"."rules") = 'object' and pg_column_size("app"."grading_schemes"."rules") <= 20000),
	CONSTRAINT "grading_schemes_source_chk" CHECK ("app"."grading_schemes"."source" in ('manual', 'ai'))
);
--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "evaluation_item_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."grading_schemes" ADD CONSTRAINT "grading_schemes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_items_subject_key_idx" ON "app"."evaluation_items" USING btree ("subject_id",lower("key"));--> statement-breakpoint
CREATE INDEX "evaluation_items_user_idx" ON "app"."evaluation_items" USING btree ("user_id");