CREATE TABLE "project_meeting_commands" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"meeting_id" integer,
	"kind" text NOT NULL,
	"request_hash" text NOT NULL,
	"http_status" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meeting_commands_scope_check" CHECK ("project_meeting_commands"."project_id">0 AND ("project_meeting_commands"."meeting_id" IS NULL OR "project_meeting_commands"."meeting_id">0)),
	CONSTRAINT "project_meeting_commands_kind_check" CHECK ("project_meeting_commands"."kind" IN ('create','update','transcript','decision','action','action-update','complete')),
	CONSTRAINT "project_meeting_commands_hash_check" CHECK ("project_meeting_commands"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "project_meeting_commands_status_check" CHECK ("project_meeting_commands"."http_status" IN (200,201,400,404,409)),
	CONSTRAINT "project_meeting_commands_response_check" CHECK (coalesce(jsonb_typeof("project_meeting_commands"."response")='object' AND octet_length("project_meeting_commands"."response"::text)<=2048 AND "project_meeting_commands"."response"->>'requestId'="project_meeting_commands"."request_id"::text AND "project_meeting_commands"."response"->>'projectId'="project_meeting_commands"."project_id"::text AND ("project_meeting_commands"."response"->>'meetingId') IS NOT DISTINCT FROM "project_meeting_commands"."meeting_id"::text AND "project_meeting_commands"."response"->>'kind'="project_meeting_commands"."kind" AND (("project_meeting_commands"."http_status"<300 AND "project_meeting_commands"."response"->>'ok'='true' AND ("project_meeting_commands"."response"->>'entityId')::bigint>0 AND "project_meeting_commands"."meeting_id">0) OR ("project_meeting_commands"."http_status">=400 AND "project_meeting_commands"."response"->>'ok'='false' AND "project_meeting_commands"."response"->'entityId'='null'::jsonb)),false))
);
--> statement-breakpoint
CREATE INDEX "project_meeting_commands_scope_idx" ON "project_meeting_commands" USING btree ("project_id","created_at","request_id");