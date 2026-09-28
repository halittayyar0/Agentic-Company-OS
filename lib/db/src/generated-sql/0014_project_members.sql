CREATE TABLE "project_members" (
	"task_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"member_role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pk" PRIMARY KEY("task_id","agent_id"),
	CONSTRAINT "project_members_role_check" CHECK ("project_members"."member_role" in ('coordinator', 'member')),
	CONSTRAINT "project_members_ids_check" CHECK ("project_members"."task_id" > 0 and "project_members"."agent_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_agent_idx" ON "project_members" USING btree ("agent_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_one_coordinator_idx" ON "project_members" USING btree ("task_id") WHERE "project_members"."member_role" = 'coordinator';--> statement-breakpoint
INSERT INTO "project_members" ("task_id", "agent_id", "member_role")
SELECT
	project_row."id",
	agent_row."id",
	CASE
		WHEN agent_row."id" = project_row."owner_agent_id" THEN 'coordinator'
		ELSE 'member'
	END
FROM "tasks" AS project_row
INNER JOIN "agents" AS agent_row ON agent_row."is_active" = true
WHERE project_row."parent_task_id" IS NULL
ON CONFLICT ("task_id", "agent_id") DO NOTHING;--> statement-breakpoint
UPDATE "project_members" AS member_row
SET "member_role" = 'coordinator'
WHERE member_row."member_role" = 'member'
AND member_row."agent_id" = (
	SELECT fallback_agent."id"
	FROM "agents" AS fallback_agent
	WHERE fallback_agent."is_active" = true
	ORDER BY
		CASE
			WHEN fallback_agent."is_root_ceo" = true THEN 0
			WHEN fallback_agent."parent_agent_id" IS NULL AND fallback_agent."depth" = 0 THEN 1
			ELSE 2
		END,
		fallback_agent."id"
	LIMIT 1
)
AND NOT EXISTS (
	SELECT 1
	FROM "project_members" AS coordinator_row
	WHERE coordinator_row."task_id" = member_row."task_id"
	AND coordinator_row."member_role" = 'coordinator'
);--> statement-breakpoint
CREATE FUNCTION "assert_project_member_root_task"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "tasks"
		WHERE "tasks"."id" = NEW."task_id"
		AND "tasks"."parent_task_id" IS NULL
	) THEN
		RAISE EXCEPTION 'project member task_id must reference a root project';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "project_members_root_task_trigger"
BEFORE INSERT OR UPDATE OF "task_id" ON "project_members"
FOR EACH ROW EXECUTE FUNCTION "assert_project_member_root_task"();--> statement-breakpoint
CREATE FUNCTION "prevent_project_with_members_becoming_child"() RETURNS trigger AS $$
BEGIN
	IF NEW."parent_task_id" IS NOT NULL AND EXISTS (
		SELECT 1 FROM "project_members"
		WHERE "project_members"."task_id" = NEW."id"
	) THEN
		RAISE EXCEPTION 'root project with members cannot become a child task';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tasks_project_members_root_invariant_trigger"
BEFORE UPDATE OF "parent_task_id" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "prevent_project_with_members_becoming_child"();
