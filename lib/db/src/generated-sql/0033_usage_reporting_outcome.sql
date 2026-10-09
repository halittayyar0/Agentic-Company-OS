ALTER TABLE "usage_events" ADD COLUMN "usage_reported" boolean;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "outcome" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "failure_kind" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_outcome_check" CHECK ("usage_events"."outcome" in ('completed', 'failed'));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_failure_check" CHECK (("usage_events"."outcome" = 'completed' and "usage_events"."failure_kind" is null) or
      ("usage_events"."outcome" = 'failed' and "usage_events"."failure_kind" is not null and length("usage_events"."failure_kind") between 1 and 64 and "usage_events"."usage_reported" is not null));