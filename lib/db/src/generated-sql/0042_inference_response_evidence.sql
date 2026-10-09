CREATE TABLE "inference_response_evidence" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"invocation_owner_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"response_id" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"reported_cost_usd" numeric(12, 6),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inference_response_evidence_route_check" CHECK (length("inference_response_evidence"."model_id") BETWEEN 1 AND 256 AND length("inference_response_evidence"."provider") BETWEEN 1 AND 32 AND length("inference_response_evidence"."response_id") BETWEEN 1 AND 256 AND "inference_response_evidence"."response_id" ~ '^[A-Za-z0-9._:-]+$'),
	CONSTRAINT "inference_response_evidence_tokens_check" CHECK ("inference_response_evidence"."prompt_tokens" >= 0 AND "inference_response_evidence"."completion_tokens" >= 0 AND "inference_response_evidence"."total_tokens" >= "inference_response_evidence"."prompt_tokens"::bigint + "inference_response_evidence"."completion_tokens"::bigint),
	CONSTRAINT "inference_response_evidence_cost_check" CHECK ("inference_response_evidence"."reported_cost_usd" IS NULL OR "inference_response_evidence"."reported_cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inference_attempts" ADD COLUMN "invocation_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "inference_attempts" ADD COLUMN "evidence_conflict_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inference_response_evidence" ADD CONSTRAINT "inference_response_evidence_attempt_id_inference_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."inference_attempts"("id") ON DELETE restrict ON UPDATE no action;