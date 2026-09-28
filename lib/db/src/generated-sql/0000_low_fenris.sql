CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"department" text,
	"parent_agent_id" integer,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"system_prompt" text NOT NULL,
	"is_custom_prompt" boolean DEFAULT false NOT NULL,
	"template_key" text,
	"model_mode" text DEFAULT 'auto' NOT NULL,
	"model_id" text,
	"avatar_color" text DEFAULT '#6366f1' NOT NULL,
	"permissions" jsonb DEFAULT '{"canCreateSubAgents":false,"canDelegate":false,"canSpend":false,"canDelete":false,"canPublish":false,"canContactExternal":false,"canBrowse":true,"canUseTerminal":true}'::jsonb NOT NULL,
	"created_by_agent_id" integer,
	"created_by_user" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
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
	"estimated_cost_usd" numeric(10, 4),
	"result_summary" text,
	"last_stepped_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
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
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
