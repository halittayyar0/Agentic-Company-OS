ALTER TABLE "usage_events" ADD COLUMN "inference_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_inference_key_unique" ON "usage_events" USING btree ("inference_key") WHERE "usage_events"."inference_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_inference_key_check" CHECK ("usage_events"."inference_key" IS NULL OR ("usage_events"."inference_key" ~ '^codex:[a-f0-9]{64}$' AND "usage_events"."provider" = 'chatgpt' AND "usage_events"."kind" = 'task_step'));
