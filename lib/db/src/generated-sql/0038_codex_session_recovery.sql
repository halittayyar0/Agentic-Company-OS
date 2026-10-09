CREATE TABLE "codex_session_recoveries" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"expected_revision" bigint NOT NULL,
	"response" jsonb NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_session_recoveries_scope" CHECK ("codex_session_recoveries"."task_id">0 AND "codex_session_recoveries"."expected_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "codex_session_recoveries_response" CHECK (jsonb_typeof("codex_session_recoveries"."response")='object' AND coalesce("codex_session_recoveries"."response"->>'outcome' IN ('accepted','rejected'),false) AND octet_length("codex_session_recoveries"."response"::text)<=32768),
	CONSTRAINT "codex_session_recoveries_snapshot" CHECK ((("codex_session_recoveries"."response"->>'outcome'='rejected' AND "codex_session_recoveries"."snapshot" IS NULL) OR ("codex_session_recoveries"."response"->>'outcome'='accepted' AND "codex_session_recoveries"."snapshot" IS NOT NULL AND jsonb_typeof("codex_session_recoveries"."snapshot")='object' AND NOT ("codex_session_recoveries"."snapshot" ?| ARRAY['ownerToken','accountId','credentials','text','prompt']) AND octet_length("codex_session_recoveries"."snapshot"::text)<=32768)))
);
--> statement-breakpoint
ALTER TABLE "codex_task_sessions" DROP CONSTRAINT "codex_task_sessions_state";--> statement-breakpoint
CREATE INDEX "codex_session_recoveries_task_created" ON "codex_session_recoveries" USING btree ("task_id","created_at");--> statement-breakpoint
ALTER TABLE "codex_task_sessions" ADD CONSTRAINT "codex_task_sessions_state" CHECK ("codex_task_sessions"."state" IN ('running','ready','uncertain','reset') AND (("codex_task_sessions"."state" = 'running' AND "codex_task_sessions"."owner_token" IS NOT NULL) OR ("codex_task_sessions"."state" <> 'running' AND "codex_task_sessions"."owner_token" IS NULL)));