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
