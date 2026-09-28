CREATE TABLE "source_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"source_path" text NOT NULL,
	"base_commit" text NOT NULL,
	"request" text NOT NULL,
	"state" text DEFAULT 'preparing' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"candidate_commit" text,
	"candidate_path" text,
	"applied_commit" text,
	"task_id" integer,
	"check" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_changes_state" CHECK ("source_changes"."state" IN ('preparing','draft','checking','verified','applying','applied','rolling_back','rolled_back','failed','unknown')),
	CONSTRAINT "source_changes_revision" CHECK ("source_changes"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "source_changes" ADD CONSTRAINT "source_changes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;