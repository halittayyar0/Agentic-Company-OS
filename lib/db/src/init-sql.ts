// AUTO-GENERATED from drizzle schema via drizzle-kit generate (see generated-sql/). Regenerate when the schema changes.
// Used by the PGlite local-dev fallback to bootstrap an in-process database.
export const INIT_SQL = `
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"department" text,
	"parent_agent_id" integer,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"current_task_id" integer,
	"current_action" text,
	"last_active_at" timestamp with time zone,
	"run_lease_owner" text,
	"run_lease_expires_at" timestamp with time zone,
	"system_prompt" text NOT NULL,
	"is_custom_prompt" boolean DEFAULT false NOT NULL,
	"template_key" text,
	"is_root_ceo" boolean DEFAULT false NOT NULL,
	"model_mode" text DEFAULT 'auto' NOT NULL,
	"model_id" text,
	"avatar_color" text DEFAULT '#6366f1' NOT NULL,
	"avatar_version" text,
	"permissions" jsonb DEFAULT '{"canCreateSubAgents":false,"canDelegate":false,"canSpend":false,"canDelete":false,"canPublish":false,"canContactExternal":false,"canBrowse":true,"canUseTerminal":true,"canUseSudo":false}'::jsonb NOT NULL,
	"created_by_agent_id" integer,
	"created_by_user" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_single_root_ceo_idx" ON "agents" USING btree ("is_root_ceo") WHERE "agents"."is_root_ceo" = true;
--> statement-breakpoint
CREATE TABLE "agent_avatars" (
	"agent_id" integer PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"image_base64" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"owner_agent_id" integer NOT NULL,
	"assigned_by_agent_id" integer,
	"created_by_user" boolean DEFAULT false NOT NULL,
	"parent_task_id" integer,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6),
	"result_summary" text,
	"execution_model_id" text,
	"last_model_id" text,
	"last_model_provider" text,
	"model_fallback_count" integer DEFAULT 0 NOT NULL,
	"autonomy_mode" text DEFAULT 'finite' NOT NULL,
	"cadence_seconds" integer,
	"last_heartbeat_at" timestamp with time zone,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"last_cycle_completed_at" timestamp with time zone,
	"last_stepped_at" timestamp with time zone,
	"step_attempts" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"blocked_reason" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_blocked_reason_check" CHECK ("blocked_reason" is null or ("status" = 'blocked' and "blocked_reason" in ('user_input', 'budget', 'runtime_failure', 'approval_rejected', 'approval_expired', 'approval_outcome_unknown', 'approval_action_failed', 'owner_inactive')))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"task_id" integer,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"task_id" integer,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"detail" jsonb,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"amount_usd" numeric(10, 2),
	"scope" jsonb,
	"action_payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"task_id" integer,
	"kind" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"reported_cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_controls" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"emergency_stop_enabled" boolean DEFAULT false NOT NULL,
	"emergency_stop_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "runtime_controls" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;
`;
