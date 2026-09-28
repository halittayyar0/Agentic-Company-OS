CREATE TABLE "execution_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mode" text DEFAULT 'approval' NOT NULL,
	"custom" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_policy_singleton" CHECK ("execution_policy"."id" = 1),
	CONSTRAINT "execution_policy_revision" CHECK ("execution_policy"."revision" >= 1),
	CONSTRAINT "execution_policy_mode" CHECK ("execution_policy"."mode" IN ('read_only', 'approval', 'full_access', 'custom'))
);
--> statement-breakpoint
INSERT INTO "execution_policy" ("id", "mode", "revision") VALUES (1, 'approval', 1);
