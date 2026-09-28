CREATE TABLE "project_meeting_turn_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"meeting_id" integer NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"lease_owner" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"http_status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meeting_turn_scope_check" CHECK ("project_meeting_turn_requests"."project_id" > 0 AND "project_meeting_turn_requests"."meeting_id" > 0),
	CONSTRAINT "project_meeting_turn_hash_check" CHECK ("project_meeting_turn_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "project_meeting_turn_state_check" CHECK ("project_meeting_turn_requests"."state" IN ('running', 'complete', 'unconfirmed')),
	CONSTRAINT "project_meeting_turn_response_check" CHECK (coalesce(("project_meeting_turn_requests"."state" = 'complete' AND "project_meeting_turn_requests"."http_status" BETWEEN 200 AND 599 AND jsonb_typeof("project_meeting_turn_requests"."response") = 'object') OR ("project_meeting_turn_requests"."state" IN ('running', 'unconfirmed') AND "project_meeting_turn_requests"."http_status" IS NULL AND "project_meeting_turn_requests"."response" IS NULL), false))
);
--> statement-breakpoint
CREATE INDEX "project_meeting_turn_scope_idx" ON "project_meeting_turn_requests" USING btree ("project_id","meeting_id","created_at");--> statement-breakpoint
CREATE INDEX "project_meeting_turn_running_idx" ON "project_meeting_turn_requests" USING btree ("state","lease_expires_at");