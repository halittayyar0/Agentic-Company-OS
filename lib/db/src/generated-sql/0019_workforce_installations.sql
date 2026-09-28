CREATE TABLE "workforce_installations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"blueprint_key" text NOT NULL,
	"blueprint_version" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_installations_hash_check" CHECK ("workforce_installations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "workforce_installations_version_check" CHECK ("workforce_installations"."blueprint_version" >= 1),
	CONSTRAINT "workforce_installations_response_check" CHECK (jsonb_typeof("workforce_installations"."response") = 'object')
);

