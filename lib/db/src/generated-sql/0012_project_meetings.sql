CREATE TABLE "project_meeting_action_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"owner_agent_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meeting_actions_title_check" CHECK (char_length(btrim("project_meeting_action_items"."title")) between 1 and 500),
	CONSTRAINT "project_meeting_actions_details_check" CHECK ("project_meeting_action_items"."details" is null or char_length("project_meeting_action_items"."details") <= 12000),
	CONSTRAINT "project_meeting_actions_status_check" CHECK ("project_meeting_action_items"."status" in ('open', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "project_meeting_actions_completion_check" CHECK (("project_meeting_action_items"."status" = 'done' and "project_meeting_action_items"."completed_at" is not null) or ("project_meeting_action_items"."status" <> 'done' and "project_meeting_action_items"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "project_meeting_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"content" text NOT NULL,
	"rationale" text,
	"owner_agent_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meeting_decisions_content_check" CHECK (char_length(btrim("project_meeting_decisions"."content")) between 1 and 12000),
	CONSTRAINT "project_meeting_decisions_rationale_check" CHECK ("project_meeting_decisions"."rationale" is null or char_length("project_meeting_decisions"."rationale") <= 12000)
);
--> statement-breakpoint
CREATE TABLE "project_meeting_participants" (
	"meeting_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meeting_participants_pk" PRIMARY KEY("meeting_id","agent_id"),
	CONSTRAINT "project_meeting_participants_ids_check" CHECK ("project_meeting_participants"."meeting_id" > 0 and "project_meeting_participants"."agent_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_meeting_transcript" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"speaker_type" text NOT NULL,
	"speaker_agent_id" integer,
	"content" text NOT NULL,
	"reply_to_transcript_id" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meeting_transcript_speaker_check" CHECK (("project_meeting_transcript"."speaker_type" = 'founder' and "project_meeting_transcript"."speaker_agent_id" is null) or ("project_meeting_transcript"."speaker_type" = 'agent' and "project_meeting_transcript"."speaker_agent_id" is not null)),
	CONSTRAINT "project_meeting_transcript_content_check" CHECK (char_length(btrim("project_meeting_transcript"."content")) between 1 and 12000)
);
--> statement-breakpoint
CREATE TABLE "project_meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"title" text NOT NULL,
	"agenda" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meetings_task_id_check" CHECK ("project_meetings"."task_id" > 0),
	CONSTRAINT "project_meetings_title_check" CHECK (char_length(btrim("project_meetings"."title")) between 1 and 200),
	CONSTRAINT "project_meetings_agenda_check" CHECK ("project_meetings"."agenda" is null or char_length("project_meetings"."agenda") <= 12000),
	CONSTRAINT "project_meetings_summary_check" CHECK ("project_meetings"."summary" is null or char_length("project_meetings"."summary") <= 30000),
	CONSTRAINT "project_meetings_status_check" CHECK ("project_meetings"."status" in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "project_meetings_time_order_check" CHECK ("project_meetings"."ended_at" is null or "project_meetings"."started_at" is null or "project_meetings"."ended_at" >= "project_meetings"."started_at")
);
--> statement-breakpoint
ALTER TABLE "project_meeting_action_items" ADD CONSTRAINT "project_meeting_action_items_meeting_id_project_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."project_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_action_items" ADD CONSTRAINT "project_meeting_action_items_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_decisions" ADD CONSTRAINT "project_meeting_decisions_meeting_id_project_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."project_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_decisions" ADD CONSTRAINT "project_meeting_decisions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_participants" ADD CONSTRAINT "project_meeting_participants_meeting_id_project_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."project_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_participants" ADD CONSTRAINT "project_meeting_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_transcript" ADD CONSTRAINT "project_meeting_transcript_meeting_id_project_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."project_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_transcript" ADD CONSTRAINT "project_meeting_transcript_speaker_agent_id_agents_id_fk" FOREIGN KEY ("speaker_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_transcript" ADD CONSTRAINT "project_meeting_transcript_reply_to_transcript_id_project_meeting_transcript_id_fk" FOREIGN KEY ("reply_to_transcript_id") REFERENCES "public"."project_meeting_transcript"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "assert_project_meeting_root_task"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "tasks"
		WHERE "tasks"."id" = NEW."task_id"
		AND "tasks"."parent_task_id" IS NULL
	) THEN
		RAISE EXCEPTION 'project meeting task_id must reference a root project';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "project_meetings_root_task_trigger"
BEFORE INSERT OR UPDATE OF "task_id" ON "project_meetings"
FOR EACH ROW EXECUTE FUNCTION "assert_project_meeting_root_task"();--> statement-breakpoint
CREATE FUNCTION "prevent_project_with_meetings_becoming_child"() RETURNS trigger AS $$
BEGIN
	IF NEW."parent_task_id" IS NOT NULL AND EXISTS (
		SELECT 1 FROM "project_meetings"
		WHERE "project_meetings"."task_id" = NEW."id"
	) THEN
		RAISE EXCEPTION 'root project with meetings cannot become a child task';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tasks_meeting_root_invariant_trigger"
BEFORE UPDATE OF "parent_task_id" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "prevent_project_with_meetings_becoming_child"();--> statement-breakpoint
CREATE INDEX "project_meeting_actions_meeting_status_idx" ON "project_meeting_action_items" USING btree ("meeting_id","status","id");--> statement-breakpoint
CREATE INDEX "project_meeting_actions_owner_idx" ON "project_meeting_action_items" USING btree ("owner_agent_id");--> statement-breakpoint
CREATE INDEX "project_meeting_decisions_meeting_idx" ON "project_meeting_decisions" USING btree ("meeting_id","created_at","id");--> statement-breakpoint
CREATE INDEX "project_meeting_participants_agent_idx" ON "project_meeting_participants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "project_meeting_transcript_order_idx" ON "project_meeting_transcript" USING btree ("meeting_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "project_meetings_task_created_idx" ON "project_meetings" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "project_meetings_task_status_idx" ON "project_meetings" USING btree ("task_id","status");
