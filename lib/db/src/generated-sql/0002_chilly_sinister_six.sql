ALTER TABLE "agents" ADD COLUMN "current_task_id" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "current_action" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_active_at" timestamp with time zone;