CREATE TABLE "chatgpt_registration_locks" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"host_id" text NOT NULL,
	CONSTRAINT "chatgpt_registration_locks_host_id_unique" UNIQUE("host_id"),
	CONSTRAINT "chatgpt_registration_lock_singleton_check" CHECK ("chatgpt_registration_locks"."singleton_id" = 1),
	CONSTRAINT "chatgpt_registration_host_check" CHECK ("chatgpt_registration_locks"."host_id" ~ '^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
);
--> statement-breakpoint
CREATE TABLE "chatgpt_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"account_digest" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatgpt_registrations_account_digest_unique" UNIQUE("account_digest"),
	CONSTRAINT "chatgpt_registration_revision_check" CHECK ("chatgpt_registrations"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "chatgpt_registration_digest_check" CHECK ("chatgpt_registrations"."account_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "chatgpt_registration_envelope_check" CHECK (octet_length("chatgpt_registrations"."ciphertext") BETWEEN 1 AND 125000 AND octet_length("chatgpt_registrations"."nonce") = 16 AND octet_length("chatgpt_registrations"."auth_tag") = 22)
);
