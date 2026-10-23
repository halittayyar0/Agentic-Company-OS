CREATE TABLE "local_model_preparations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_revision" bigint NOT NULL,
	"state" text NOT NULL,
	"phase" text DEFAULT 'preparing' NOT NULL,
	"observed_completed_bytes" bigint DEFAULT 0 NOT NULL,
	"observed_total_bytes" bigint DEFAULT 0 NOT NULL,
	"progress_reset" boolean DEFAULT false NOT NULL,
	"owner_runtime_id" text NOT NULL,
	"owner_epoch" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"failure_code" text,
	"result_model_id" text,
	"result_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "local_model_preparations_hash_check" CHECK ("local_model_preparations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "local_model_preparations_recipe_check" CHECK ("local_model_preparations"."model_id" = 'qwen35-2b' and "local_model_preparations"."provider_revision" between 0 and 9007199254740991),
	CONSTRAINT "local_model_preparations_state_check" CHECK ("local_model_preparations"."state" in ('requested','downloading','verifying','stopping','ready','interrupted','failed') and "local_model_preparations"."phase" in ('preparing','downloading','checking','downloaded')),
	CONSTRAINT "local_model_preparations_bytes_check" CHECK ("local_model_preparations"."observed_completed_bytes" >= 0 and "local_model_preparations"."observed_total_bytes" between "local_model_preparations"."observed_completed_bytes" and 3221225472),
	CONSTRAINT "local_model_preparations_owner_check" CHECK (octet_length("local_model_preparations"."owner_runtime_id") between 1 and 256),
	CONSTRAINT "local_model_preparations_outcome_check" CHECK (coalesce(
    ("local_model_preparations"."state" in ('requested','downloading','verifying','stopping') and "local_model_preparations"."failure_code" is null and "local_model_preparations"."finished_at" is null and "local_model_preparations"."result_model_id" is null and "local_model_preparations"."result_digest" is null)
    or ("local_model_preparations"."state" = 'ready' and "local_model_preparations"."failure_code" is null and "local_model_preparations"."finished_at" is not null and "local_model_preparations"."result_model_id" = 'ollama:qwen3.5:2b-q4_K_M' and "local_model_preparations"."result_digest" ~ '^sha256:[a-f0-9]{64}$')
    or ("local_model_preparations"."state" in ('failed','interrupted') and "local_model_preparations"."failure_code" in ('INTERRUPTED','CONFIG_CHANGED','SERVER_UNAVAILABLE','RUNTIME_UPDATE_REQUIRED','MODEL_UNVERIFIED','DISPATCH_FAILED','DEADLINE_EXCEEDED','INVALID_PROGRESS','FRAME_TOO_LARGE','TOO_MANY_LAYERS','MODEL_TOO_LARGE','UPSTREAM_ERROR','INCOMPLETE_PROGRESS','STREAM_FAILED') and "local_model_preparations"."finished_at" is not null and "local_model_preparations"."result_model_id" is null and "local_model_preparations"."result_digest" is null), false))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "local_model_preparations_one_active" ON "local_model_preparations" USING btree ((1)) WHERE "local_model_preparations"."state" in ('requested','downloading','verifying','stopping');--> statement-breakpoint
CREATE INDEX "local_model_preparations_created_idx" ON "local_model_preparations" USING btree ("created_at");