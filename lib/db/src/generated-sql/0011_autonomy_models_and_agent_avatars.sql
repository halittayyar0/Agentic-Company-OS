CREATE TABLE "agent_avatars" (
	"agent_id" integer PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"image_base64" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_avatars_mime_type_check" CHECK ("agent_avatars"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "agent_avatars_image_size_check" CHECK (char_length("agent_avatars"."image_base64") <= 90000)
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "avatar_version" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "execution_model_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_model_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_model_provider" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "model_fallback_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
UPDATE "tasks"
SET "execution_model_id" = "agents"."model_id"
FROM "agents"
WHERE "tasks"."owner_agent_id" = "agents"."id"
	AND "tasks"."autonomy_mode" = 'continuous'
	AND "tasks"."execution_model_id" IS NULL
	AND "agents"."model_mode" = 'manual'
	AND "agents"."model_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_avatars" ADD CONSTRAINT "agent_avatars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_avatar_version_check" CHECK ("agents"."avatar_version" is null or char_length("agents"."avatar_version") <= 64);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_model_fallback_count_check" CHECK ("tasks"."model_fallback_count" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_reason_check" CHECK ("tasks"."blocked_reason" is null or ("tasks"."status" = 'blocked' and "tasks"."blocked_reason" in ('user_input', 'budget', 'runtime_failure', 'approval_rejected', 'approval_expired', 'approval_outcome_unknown', 'approval_action_failed', 'owner_inactive')));
