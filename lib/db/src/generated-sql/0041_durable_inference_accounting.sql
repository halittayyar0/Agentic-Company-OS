CREATE TABLE "inference_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"task_id" integer,
	"scope_key" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_deadline_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "inference_attempts_scope_check" CHECK ("inference_attempts"."scope_key" ~ '^(task|agent):[1-9][0-9]{0,9}$' AND "inference_attempts"."agent_id" > 0 AND ("inference_attempts"."task_id" IS NULL OR "inference_attempts"."task_id" > 0)),
	CONSTRAINT "inference_attempts_route_check" CHECK (length("inference_attempts"."model_id") BETWEEN 1 AND 256 AND length("inference_attempts"."provider") BETWEEN 1 AND 32 AND "inference_attempts"."kind" IN ('chat','task_step','judge')),
	CONSTRAINT "inference_attempts_state_check" CHECK (("inference_attempts"."state" IN ('reserved','not_dispatched') AND "inference_attempts"."dispatched_at" IS NULL) OR ("inference_attempts"."state" IN ('dispatched','accounted','uncertain') AND "inference_attempts"."dispatched_at" IS NOT NULL)),
	CONSTRAINT "inference_attempts_settlement_check" CHECK (("inference_attempts"."state" IN ('accounted','uncertain','not_dispatched')) = ("inference_attempts"."settled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "ordinary_inference_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "inference_attempts_unsettled_scope_unique" ON "inference_attempts" USING btree ("scope_key") WHERE "inference_attempts"."state" IN ('reserved','dispatched','uncertain');--> statement-breakpoint
CREATE UNIQUE INDEX "inference_attempts_unsettled_agent_unique" ON "inference_attempts" USING btree ("agent_id") WHERE "inference_attempts"."state" IN ('reserved','dispatched','uncertain');--> statement-breakpoint
CREATE INDEX "inference_attempts_state_created_idx" ON "inference_attempts" USING btree ("state","created_at");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_ordinary_inference_id_inference_attempts_id_fk" FOREIGN KEY ("ordinary_inference_id") REFERENCES "public"."inference_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_ordinary_inference_unique" ON "usage_events" USING btree ("ordinary_inference_id") WHERE "usage_events"."ordinary_inference_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_correlation_kind_check" CHECK ("usage_events"."inference_key" IS NULL OR "usage_events"."ordinary_inference_id" IS NULL);