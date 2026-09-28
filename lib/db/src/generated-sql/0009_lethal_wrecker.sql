ALTER TABLE "tasks" ADD COLUMN "autonomy_mode" text DEFAULT 'finite' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cadence_seconds" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recovery_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cycle_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_cycle_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_autonomy_mode_check" CHECK ("tasks"."autonomy_mode" in ('finite', 'continuous'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cadence_seconds_check" CHECK ("tasks"."cadence_seconds" is null or "tasks"."cadence_seconds" between 60 and 604800);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recovery_count_check" CHECK ("tasks"."recovery_count" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cycle_count_check" CHECK ("tasks"."cycle_count" >= 0);