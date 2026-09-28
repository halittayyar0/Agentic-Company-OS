ALTER TABLE "agents" ALTER COLUMN "permissions" SET DEFAULT '{"canCreateSubAgents":false,"canDelegate":false,"canSpend":false,"canDelete":false,"canPublish":false,"canContactExternal":false,"canBrowse":true,"canUseTerminal":true,"canUseSudo":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "is_root_ceo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH "canonical_root_ceo" AS (
	SELECT min("id") AS "id"
	FROM "agents"
	WHERE "depth" = 0 AND "parent_agent_id" IS NULL AND "template_key" = 'ceo'
	HAVING count(*) = 1
)
UPDATE "agents"
SET "is_root_ceo" = true
WHERE "id" = (SELECT "id" FROM "canonical_root_ceo");--> statement-breakpoint
UPDATE "agents"
SET "permissions" = "permissions" || jsonb_build_object('canUseSudo', "is_root_ceo")
WHERE NOT ("permissions" ? 'canUseSudo');--> statement-breakpoint
CREATE UNIQUE INDEX "agents_single_root_ceo_idx" ON "agents" USING btree ("is_root_ceo") WHERE "agents"."is_root_ceo" = true;
