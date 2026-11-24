CREATE TABLE "app"."moodle_connections" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"ics_host" text NOT NULL,
	"ics_url_enc" text NOT NULL,
	"base_url" text,
	"wstoken_enc" text,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moodle_connections_user_key" UNIQUE("user_id"),
	CONSTRAINT "moodle_connections_base_url_chk" CHECK ("app"."moodle_connections"."base_url" is null or ("app"."moodle_connections"."base_url" ~ '^https://' and char_length("app"."moodle_connections"."base_url") <= 300)),
	CONSTRAINT "moodle_connections_token_chk" CHECK ("app"."moodle_connections"."wstoken_enc" is null or "app"."moodle_connections"."base_url" is not null),
	CONSTRAINT "moodle_connections_error_chk" CHECK ("app"."moodle_connections"."last_sync_error" is null or char_length("app"."moodle_connections"."last_sync_error") <= 300),
	CONSTRAINT "moodle_connections_host_chk" CHECK (char_length("app"."moodle_connections"."ics_host") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "app"."moodle_course_mappings" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_key" text NOT NULL,
	"subject_id" uuid,
	"ignored" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moodle_course_mappings_user_course_key" UNIQUE("user_id","course_key"),
	CONSTRAINT "moodle_course_mappings_course_chk" CHECK (char_length("app"."moodle_course_mappings"."course_key") between 1 and 200),
	CONSTRAINT "moodle_course_mappings_ignored_chk" CHECK (not ("app"."moodle_course_mappings"."ignored" and "app"."moodle_course_mappings"."subject_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD COLUMN "external_course_key" text;--> statement-breakpoint
ALTER TABLE "app"."moodle_connections" ADD CONSTRAINT "moodle_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."moodle_course_mappings" ADD CONSTRAINT "moodle_course_mappings_connection_fk" FOREIGN KEY ("user_id") REFERENCES "app"."moodle_connections"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moodle_connections_next_sync_idx" ON "app"."moodle_connections" USING btree ("next_sync_at") WHERE "app"."moodle_connections"."sync_enabled";--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_external_course_chk" CHECK ("app"."tasks"."external_course_key" is null or ("app"."tasks"."source" <> 'manual' and char_length("app"."tasks"."external_course_key") <= 200));