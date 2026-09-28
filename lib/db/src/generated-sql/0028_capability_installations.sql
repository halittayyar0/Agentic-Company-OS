CREATE TABLE "capability_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"manifest" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_installations_namespace" CHECK ("capability_installations"."id" ~ '^user-[a-z0-9][a-z0-9-]{0,59}$'),
	CONSTRAINT "capability_installations_revision" CHECK ("capability_installations"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "capability_preferences" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled_packs" jsonb DEFAULT '["data","documents","web","code","planning"]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "capability_preferences_singleton" CHECK ("capability_preferences"."id" = 1)
);

--> statement-breakpoint
INSERT INTO capability_preferences (id) VALUES (1) ON CONFLICT DO NOTHING;
