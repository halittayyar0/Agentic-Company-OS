ALTER TABLE "agents" ADD COLUMN "run_lease_owner" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "run_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "step_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_expires_at" timestamp with time zone;