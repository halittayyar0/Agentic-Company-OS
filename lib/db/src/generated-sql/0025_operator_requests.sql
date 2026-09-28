CREATE TABLE "operator_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"kind" text NOT NULL,
	"request_hash" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"runtime_version" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"ok" boolean,
	"exit_code" integer,
	"duration_ms" integer,
	"failure_code" text,
	"result_ciphertext" text,
	"result_nonce" text,
	"result_auth_tag" text,
	CONSTRAINT "operator_requests_scope_check" CHECK ("operator_requests"."agent_id" > 0 AND "operator_requests"."runtime_version" >= 0),
	CONSTRAINT "operator_requests_kind_check" CHECK ("operator_requests"."kind" IN ('terminal_sandbox','terminal_host','browser_take_over','browser_navigate','browser_input','browser_release','browser_close')),
	CONSTRAINT "operator_requests_hash_check" CHECK ("operator_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "operator_requests_failure_check" CHECK ("operator_requests"."failure_code" IS NULL OR "operator_requests"."failure_code" IN ('execution_blocked','authority_unavailable','invalid_session','transport_unavailable','execution_error','deadline_expired','server_interrupted')),
	CONSTRAINT "operator_requests_cipher_check" CHECK (coalesce(( "operator_requests"."result_ciphertext" IS NULL AND "operator_requests"."result_nonce" IS NULL AND "operator_requests"."result_auth_tag" IS NULL ) OR (octet_length("operator_requests"."result_ciphertext") BETWEEN 1 AND 8388608 AND "operator_requests"."result_ciphertext" ~ '^[A-Za-z0-9_-]+$' AND "operator_requests"."result_nonce" ~ '^[A-Za-z0-9_-]{16}$' AND "operator_requests"."result_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'), false)),
	CONSTRAINT "operator_requests_state_check" CHECK (coalesce(
    ("operator_requests"."state" IN ('reserved','dispatched') AND "operator_requests"."completed_at" IS NULL AND "operator_requests"."failure_code" IS NULL AND "operator_requests"."ok" IS NULL AND "operator_requests"."exit_code" IS NULL AND "operator_requests"."duration_ms" IS NULL AND "operator_requests"."result_ciphertext" IS NULL AND (("operator_requests"."state"='reserved' AND "operator_requests"."dispatched_at" IS NULL) OR ("operator_requests"."state"='dispatched' AND "operator_requests"."dispatched_at" IS NOT NULL)))
    OR ("operator_requests"."state" IN ('not_dispatched','unknown') AND "operator_requests"."completed_at" IS NOT NULL AND "operator_requests"."failure_code" IS NOT NULL AND "operator_requests"."ok" IS NULL AND "operator_requests"."exit_code" IS NULL AND "operator_requests"."duration_ms" IS NULL AND "operator_requests"."result_ciphertext" IS NULL AND (("operator_requests"."state"='not_dispatched' AND "operator_requests"."dispatched_at" IS NULL) OR ("operator_requests"."state"='unknown' AND "operator_requests"."dispatched_at" IS NOT NULL)))
    OR ("operator_requests"."state"='complete' AND "operator_requests"."completed_at" IS NOT NULL AND "operator_requests"."failure_code" IS NULL AND (( "operator_requests"."kind" IN ('terminal_sandbox','terminal_host') AND "operator_requests"."ok" IS NOT NULL AND ("operator_requests"."ok"=false OR "operator_requests"."exit_code"=0) AND "operator_requests"."duration_ms" BETWEEN 0 AND 86400000 AND "operator_requests"."result_ciphertext" IS NOT NULL ) OR ( "operator_requests"."kind" NOT IN ('terminal_sandbox','terminal_host') AND "operator_requests"."ok" IS NULL AND "operator_requests"."exit_code" IS NULL AND "operator_requests"."duration_ms" IS NULL AND "operator_requests"."result_ciphertext" IS NULL )))
  , false))
);
--> statement-breakpoint
CREATE INDEX "operator_requests_scope_idx" ON "operator_requests" USING btree ("agent_id","created_at","request_id");--> statement-breakpoint
CREATE INDEX "operator_requests_active_idx" ON "operator_requests" USING btree ("agent_id","state","expires_at");