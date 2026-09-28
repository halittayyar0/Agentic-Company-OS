CREATE TABLE "operation_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"execution_kind" text NOT NULL,
	"state" text DEFAULT 'claimed' NOT NULL,
	"attempt_id" text,
	"worker_instance_id" text,
	"model_tool_call_id" text,
	"lease_owner" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"task_lease_owner" text,
	"agent_lease_owner" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effect_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_kind" text,
	"sanitized_error" text,
	CONSTRAINT "operation_invocations_execution_kind_check" CHECK ((
        ("operation_invocations"."execution_kind" = 'task_step' and "operation_invocations"."attempt_id" is not null and "operation_invocations"."worker_instance_id" is not null and "operation_invocations"."task_lease_owner" is not null and "operation_invocations"."agent_lease_owner" is not null)
        or ("operation_invocations"."execution_kind" = 'approved_action' and "operation_invocations"."attempt_id" is null and "operation_invocations"."worker_instance_id" is not null and "operation_invocations"."task_lease_owner" is null and "operation_invocations"."agent_lease_owner" is not null)
        or ("operation_invocations"."execution_kind" = 'chat_turn' and "operation_invocations"."attempt_id" is null and "operation_invocations"."task_lease_owner" is null and "operation_invocations"."agent_lease_owner" is not null)
      )),
	CONSTRAINT "operation_invocations_state_check" CHECK ("operation_invocations"."state" in ('claimed', 'running', 'succeeded', 'failed', 'unknown')),
	CONSTRAINT "operation_invocations_state_timestamps_check" CHECK ((
        ("operation_invocations"."state" = 'claimed' and "operation_invocations"."effect_started_at" is null and "operation_invocations"."finished_at" is null)
        or ("operation_invocations"."state" = 'running' and "operation_invocations"."effect_started_at" is not null and "operation_invocations"."finished_at" is null)
        or ("operation_invocations"."state" = 'failed' and "operation_invocations"."finished_at" is not null)
        or ("operation_invocations"."state" in ('succeeded', 'unknown') and "operation_invocations"."effect_started_at" is not null and "operation_invocations"."finished_at" is not null)
      )),
	CONSTRAINT "operation_invocations_bounded_text_check" CHECK (octet_length("operation_invocations"."lease_owner") <= 1024
        and ("operation_invocations"."task_lease_owner" is null or octet_length("operation_invocations"."task_lease_owner") <= 1024)
        and octet_length("operation_invocations"."agent_lease_owner") <= 1024
        and ("operation_invocations"."model_tool_call_id" is null or octet_length("operation_invocations"."model_tool_call_id") <= 512)
        and ("operation_invocations"."failure_kind" is null or octet_length("operation_invocations"."failure_kind") <= 256)
        and ("operation_invocations"."sanitized_error" is null or octet_length("operation_invocations"."sanitized_error") <= 4096))
);
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_blocked_reason_check";--> statement-breakpoint
ALTER TABLE "operation_receipts" DROP CONSTRAINT "operation_receipts_side_effect_class_check";--> statement-breakpoint
ALTER TABLE "operation_receipts" DROP CONSTRAINT "operation_receipts_attempt_id_task_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "operation_receipts" DROP CONSTRAINT "operation_receipts_worker_instance_id_runtime_instances_id_fk";
--> statement-breakpoint
DROP INDEX "operation_receipts_attempt_id_idx";--> statement-breakpoint
ALTER TABLE "operation_receipts" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "browser_runtime_instance_id" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "browser_session_id" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "browser_session_epoch" integer;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "browser_snapshot_marker" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "browser_binding_hash" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "binding_invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "binding_invalidation_reason" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "canonical_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "replay_key" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "execution_kind" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "logical_execution_id" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "approval_id" integer;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "source_message_id" integer;--> statement-breakpoint
ALTER TABLE "operation_receipts" RENAME COLUMN "attempt_id" TO "origin_attempt_id";--> statement-breakpoint
ALTER TABLE "operation_receipts" ALTER COLUMN "origin_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "result_data" jsonb;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "reconciliation_decision" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "reconciliation_note" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "reconciliation_actor_id" text;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
-- Legacy consumed approvals may retain exact command text or browser context
-- in both the capability scope and its resolution event. Match on the
-- non-sensitive tool/hash identity and keep only an optional non-browser
-- target before replacing each scope with a durable tombstone.
WITH "consumed_action_approvals" AS (
	SELECT DISTINCT
		"agent_id",
		"task_id",
		"scope" ->> 'toolName' AS "tool_name",
		"scope" ->> 'argsHash' AS "args_hash",
		CASE
			WHEN "scope" ->> 'toolName' IN ('browser_click', 'browser_type') THEN NULL
			ELSE "scope" -> 'target'
		END AS "target"
	FROM "approval_requests"
	WHERE "consumed_at" IS NOT NULL
		AND jsonb_typeof("scope") = 'object'
		AND "scope" ->> 'toolName' IS NOT NULL
		AND "scope" ->> 'argsHash' IS NOT NULL
)
UPDATE "activity_events" AS "event"
SET "detail" = jsonb_set(
	"event"."detail",
	'{scope}',
	jsonb_strip_nulls(jsonb_build_object(
		'toolName', "approval"."tool_name",
		'argsHash', "approval"."args_hash",
		'target', "approval"."target"
	)),
	true
)
FROM "consumed_action_approvals" AS "approval"
WHERE "event"."type" = 'approval_resolved'
	AND "event"."agent_id" = "approval"."agent_id"
	AND "event"."task_id" = "approval"."task_id"
	AND jsonb_typeof("event"."detail") = 'object'
	AND jsonb_typeof("event"."detail" -> 'scope') = 'object'
	AND "event"."detail" #>> '{scope,toolName}' = "approval"."tool_name"
	AND "event"."detail" #>> '{scope,argsHash}' IS NOT DISTINCT FROM "approval"."args_hash";--> statement-breakpoint
UPDATE "approval_requests"
SET "scope" = jsonb_strip_nulls(jsonb_build_object(
	'toolName', "scope" ->> 'toolName',
	'argsHash', "scope" ->> 'argsHash',
	'target', CASE
		WHEN "scope" ->> 'toolName' IN ('browser_click', 'browser_type') THEN NULL
		ELSE "scope" -> 'target'
	END
))
WHERE "consumed_at" IS NOT NULL
	AND jsonb_typeof("scope") = 'object'
	AND "scope" ->> 'toolName' IS NOT NULL
	AND "scope" ->> 'argsHash' IS NOT NULL;--> statement-breakpoint
UPDATE "approval_requests"
SET "action_payload" = NULL
WHERE "consumed_at" IS NOT NULL;--> statement-breakpoint
-- Legacy rejected approvals may still retain exact command text or browser
-- context in both the capability scope and the matching resolution event.
-- A well-formed identity keeps only its digest and optional non-browser
-- target. Any partial, malformed, or non-object identity is replaced with a
-- source-independent tombstone so untrusted legacy JSON can never survive.
UPDATE "activity_events" AS "event"
SET "detail" = jsonb_set(
	"event"."detail",
	'{scope}',
	CASE
		WHEN jsonb_typeof("event"."detail" -> 'scope') = 'object'
			AND jsonb_typeof("event"."detail" #> '{scope,toolName}') = 'string'
			AND nullif("event"."detail" #>> '{scope,toolName}', '') IS NOT NULL
			AND jsonb_typeof("event"."detail" #> '{scope,argsHash}') = 'string'
			AND nullif("event"."detail" #>> '{scope,argsHash}', '') IS NOT NULL
		THEN jsonb_build_object(
			'toolName', "event"."detail" #>> '{scope,toolName}',
			'argsHash', "event"."detail" #>> '{scope,argsHash}',
			'target', CASE
				WHEN "event"."detail" #>> '{scope,toolName}' IN ('browser_click', 'browser_type') THEN NULL
				WHEN jsonb_typeof("event"."detail" #> '{scope,target}') = 'string' THEN "event"."detail" #> '{scope,target}'
				ELSE NULL
			END,
			'preview', 'REJECTED: capability sha256:' || ("event"."detail" #>> '{scope,argsHash}')
		)
		ELSE jsonb_build_object(
			'toolName', 'legacy_redacted',
			'argsHash', 'legacy-redacted',
			'target', NULL,
			'preview', 'REJECTED: legacy capability redacted'
		)
	END,
	true
)
WHERE "event"."type" = 'approval_resolved'
	AND jsonb_typeof("event"."detail") = 'object'
	AND "event"."detail" ? 'scope'
	AND EXISTS (
		SELECT 1
		FROM "approval_requests" AS "approval"
		WHERE "approval"."status" = 'rejected'
			AND "approval"."agent_id" = "event"."agent_id"
			AND "approval"."task_id" = "event"."task_id"
			AND (
				"event"."detail" ->> 'status' = 'rejected'
				OR jsonb_typeof("approval"."scope") IS DISTINCT FROM 'object'
				OR jsonb_typeof("approval"."scope" -> 'toolName') IS DISTINCT FROM 'string'
				OR nullif("approval"."scope" ->> 'toolName', '') IS NULL
				OR jsonb_typeof("approval"."scope" -> 'argsHash') IS DISTINCT FROM 'string'
				OR nullif("approval"."scope" ->> 'argsHash', '') IS NULL
				OR jsonb_typeof("event"."detail" -> 'scope') IS DISTINCT FROM 'object'
				OR jsonb_typeof("event"."detail" #> '{scope,toolName}') IS DISTINCT FROM 'string'
				OR nullif("event"."detail" #>> '{scope,toolName}', '') IS NULL
				OR jsonb_typeof("event"."detail" #> '{scope,argsHash}') IS DISTINCT FROM 'string'
				OR nullif("event"."detail" #>> '{scope,argsHash}', '') IS NULL
				OR (
					"event"."detail" #>> '{scope,toolName}' = "approval"."scope" ->> 'toolName'
					AND "event"."detail" #>> '{scope,argsHash}' = "approval"."scope" ->> 'argsHash'
				)
			)
	);--> statement-breakpoint
UPDATE "approval_requests"
SET
	"scope" = CASE
		WHEN jsonb_typeof("scope") = 'object'
			AND jsonb_typeof("scope" -> 'toolName') = 'string'
			AND nullif("scope" ->> 'toolName', '') IS NOT NULL
			AND jsonb_typeof("scope" -> 'argsHash') = 'string'
			AND nullif("scope" ->> 'argsHash', '') IS NOT NULL
		THEN jsonb_build_object(
			'toolName', "scope" ->> 'toolName',
			'argsHash', "scope" ->> 'argsHash',
			'target', CASE
				WHEN "scope" ->> 'toolName' IN ('browser_click', 'browser_type') THEN NULL
				WHEN jsonb_typeof("scope" -> 'target') = 'string' THEN "scope" -> 'target'
				ELSE NULL
			END,
			'preview', 'REJECTED: capability sha256:' || ("scope" ->> 'argsHash')
		)
		ELSE jsonb_build_object(
			'toolName', 'legacy_redacted',
			'argsHash', 'legacy-redacted',
			'target', NULL,
			'preview', 'REJECTED: legacy capability redacted'
		)
	END,
	"action_payload" = NULL
WHERE "status" = 'rejected';--> statement-breakpoint
ALTER TABLE "task_attempts" ADD COLUMN "logical_execution_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
-- Infer only unambiguous, adjacent recovery links left implicit by legacy workers.
WITH "recovery_candidates" AS (
	SELECT
		"child"."id" AS "child_id",
		min("parent"."id") AS "parent_id",
		count(*) AS "candidate_count"
	FROM "task_attempts" AS "child"
	INNER JOIN "task_attempts" AS "parent"
		ON "parent"."task_id" = "child"."task_id"
		AND "parent"."agent_id" = "child"."agent_id"
		AND "parent"."cycle_number" = "child"."cycle_number"
		AND "parent"."attempt_number" = "child"."attempt_number" - 1
		AND "parent"."state" IN ('lost', 'retrying')
	WHERE "child"."recovery_of_attempt_id" IS NULL
		AND "child"."attempt_number" > 1
	GROUP BY "child"."id"
	HAVING count(*) = 1
)
UPDATE "task_attempts" AS "child"
SET "recovery_of_attempt_id" = "candidate"."parent_id"
FROM "recovery_candidates" AS "candidate"
WHERE "child"."id" = "candidate"."child_id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "task_attempts" AS "child"
		INNER JOIN "task_attempts" AS "parent"
			ON "parent"."id" = "child"."recovery_of_attempt_id"
		WHERE "parent"."task_id" IS DISTINCT FROM "child"."task_id"
			OR "parent"."agent_id" IS DISTINCT FROM "child"."agent_id"
			OR "parent"."cycle_number" IS DISTINCT FROM "child"."cycle_number"
			OR "parent"."attempt_number" >= "child"."attempt_number"
			OR "parent"."state" NOT IN ('lost', 'retrying')
	) THEN
		RAISE EXCEPTION 'legacy recovery chain has contradictory identity evidence';
	END IF;
END
$$;--> statement-breakpoint
-- A deterministic UUID per recovery root keeps every descendant on one logical execution.
WITH RECURSIVE "attempt_roots" ("attempt_id", "root_id") AS (
	SELECT "id", "id"
	FROM "task_attempts"
	WHERE "recovery_of_attempt_id" IS NULL
	UNION
	SELECT "child"."id", "parent"."root_id"
	FROM "task_attempts" AS "child"
	INNER JOIN "attempt_roots" AS "parent"
		ON "child"."recovery_of_attempt_id" = "parent"."attempt_id"
),
"root_digests" AS (
	SELECT
		"attempt_id",
		md5('agentic-company-os/task-logical-execution/v1:' || "root_id") AS "digest"
	FROM "attempt_roots"
)
UPDATE "task_attempts" AS "attempt"
SET "logical_execution_id" = (
	substr("root"."digest", 1, 8) || '-' ||
	substr("root"."digest", 9, 4) || '-5' ||
	substr("root"."digest", 14, 3) || '-8' ||
	substr("root"."digest", 18, 3) || '-' ||
	substr("root"."digest", 21, 12)
)::uuid
FROM "root_digests" AS "root"
WHERE "attempt"."id" = "root"."attempt_id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "operation_receipts"
		WHERE "side_effect_class" <> 'read_only'
			AND "external_idempotency_key" IS NULL
	) THEN
		RAISE EXCEPTION 'legacy operation receipt lacks replay evidence';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "operation_receipts"
		WHERE ("state" = 'reserved' AND ("started_at" IS NOT NULL OR "finished_at" IS NOT NULL))
			OR ("state" = 'running' AND ("started_at" IS NULL OR "finished_at" IS NOT NULL))
			OR ("state" IN ('succeeded', 'failed', 'unknown') AND "finished_at" IS NULL)
	) THEN
		RAISE EXCEPTION 'legacy operation receipt has contradictory state timestamps';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "operation_receipts" AS "receipt"
		LEFT JOIN "task_attempts" AS "attempt"
			ON "attempt"."id" = "receipt"."origin_attempt_id"
		WHERE "attempt"."id" IS NULL
	) THEN
		RAISE EXCEPTION 'legacy operation receipt lacks an origin attempt';
	END IF;
END
$$;--> statement-breakpoint
UPDATE "operation_receipts" AS "receipt"
SET
	"execution_kind" = 'task_step',
	"logical_execution_id" = "attempt"."logical_execution_id"::text,
	"replay_key" = CASE
		WHEN "receipt"."side_effect_class" = 'read_only' THEN NULL
		ELSE "receipt"."external_idempotency_key"
	END,
	"state" = CASE
		WHEN "receipt"."state" = 'running'
			AND "receipt"."side_effect_class" IN ('at_most_once', 'approval_at_most_once')
		THEN 'unknown'
		ELSE "receipt"."state"
	END,
	"finished_at" = CASE
		WHEN "receipt"."state" = 'running'
			AND "receipt"."side_effect_class" IN ('at_most_once', 'approval_at_most_once')
		THEN clock_timestamp()
		ELSE "receipt"."finished_at"
	END,
	"failure_kind" = CASE
		WHEN "receipt"."state" = 'running'
			AND "receipt"."side_effect_class" IN ('at_most_once', 'approval_at_most_once')
		THEN coalesce("receipt"."failure_kind", 'legacy_operation_outcome_unknown')
		ELSE "receipt"."failure_kind"
	END,
	"sanitized_error" = CASE
		WHEN "receipt"."state" = 'running'
			AND "receipt"."side_effect_class" IN ('at_most_once', 'approval_at_most_once')
		THEN coalesce("receipt"."sanitized_error", 'Legacy effect may have started; reconciliation is required.')
		ELSE "receipt"."sanitized_error"
	END
FROM "task_attempts" AS "attempt"
WHERE "attempt"."id" = "receipt"."origin_attempt_id";--> statement-breakpoint
INSERT INTO "operation_invocations" (
	"id",
	"receipt_id",
	"execution_kind",
	"state",
	"attempt_id",
	"worker_instance_id",
	"model_tool_call_id",
	"lease_owner",
	"lease_expires_at",
	"task_lease_owner",
	"agent_lease_owner",
	"claimed_at",
	"last_heartbeat_at",
	"effect_started_at",
	"finished_at",
	"failure_kind",
	"sanitized_error"
)
SELECT
	'legacy:' || "receipt"."id",
	"receipt"."id",
	'task_step',
	CASE WHEN "receipt"."state" = 'reserved' THEN 'failed' ELSE "receipt"."state" END,
	"receipt"."origin_attempt_id",
	coalesce("receipt"."worker_instance_id", "attempt"."worker_instance_id"),
	"receipt"."model_tool_call_id",
	"attempt"."lease_owner",
	coalesce("receipt"."finished_at", "receipt"."started_at", "receipt"."reserved_at"),
	"attempt"."lease_owner",
	"attempt"."lease_owner",
	"receipt"."reserved_at",
	coalesce("receipt"."started_at", "receipt"."reserved_at"),
	"receipt"."started_at",
	CASE
		WHEN "receipt"."state" = 'reserved' THEN "receipt"."reserved_at"
		WHEN "receipt"."state" IN ('succeeded', 'failed', 'unknown') THEN "receipt"."finished_at"
		ELSE NULL
	END,
	CASE
		WHEN "receipt"."state" = 'reserved' THEN coalesce("receipt"."failure_kind", 'legacy_pre_effect_unclaimed')
		ELSE "receipt"."failure_kind"
	END,
	CASE
		WHEN "receipt"."state" = 'reserved' THEN coalesce("receipt"."sanitized_error", 'Legacy reservation had no trustworthy active owner; safe reclaim is permitted.')
		ELSE "receipt"."sanitized_error"
	END
FROM "operation_receipts" AS "receipt"
INNER JOIN "task_attempts" AS "attempt"
	ON "attempt"."id" = "receipt"."origin_attempt_id";--> statement-breakpoint
UPDATE "task_attempts" AS "attempt"
SET
	"state" = 'blocked',
	"finished_at" = coalesce("attempt"."finished_at", clock_timestamp()),
	"failure_kind" = coalesce("attempt"."failure_kind", 'operation_outcome_unknown'),
	"sanitized_error" = coalesce("attempt"."sanitized_error", 'A legacy operation outcome requires reconciliation.')
WHERE "attempt"."state" IN ('claimed', 'running', 'retrying')
	AND "attempt"."task_id" IN (
		SELECT DISTINCT "task_id"
		FROM "operation_receipts"
		WHERE "state" = 'unknown' AND "task_id" IS NOT NULL
	);--> statement-breakpoint
UPDATE "tasks"
SET
	"status" = 'blocked',
	"blocked_reason" = 'operation_outcome_unknown',
	"lease_owner" = NULL,
	"lease_expires_at" = NULL,
	"next_attempt_at" = NULL
WHERE "id" IN (
	SELECT DISTINCT "task_id"
	FROM "operation_receipts"
	WHERE "state" = 'unknown' AND "task_id" IS NOT NULL
);--> statement-breakpoint
ALTER TABLE "operation_receipts" ALTER COLUMN "execution_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_receipts" ALTER COLUMN "logical_execution_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_invocations" ADD CONSTRAINT "operation_invocations_receipt_id_operation_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."operation_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_invocations" ADD CONSTRAINT "operation_invocations_attempt_id_task_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."task_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_invocations" ADD CONSTRAINT "operation_invocations_worker_instance_id_runtime_instances_id_fk" FOREIGN KEY ("worker_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_invocations_receipt_id_idx" ON "operation_invocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "operation_invocations_attempt_id_idx" ON "operation_invocations" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "operation_invocations_worker_instance_id_idx" ON "operation_invocations" USING btree ("worker_instance_id");--> statement-breakpoint
CREATE INDEX "operation_invocations_state_idx" ON "operation_invocations" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_invocations_one_active_per_receipt" ON "operation_invocations" USING btree ("receipt_id") WHERE "operation_invocations"."state" in ('claimed', 'running');--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_browser_runtime_instance_id_runtime_instances_id_fk" FOREIGN KEY ("browser_runtime_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_origin_attempt_id_task_attempts_id_fk" FOREIGN KEY ("origin_attempt_id") REFERENCES "public"."task_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_receipts_replay_key_unique" ON "operation_receipts" USING btree ("replay_key");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_receipts_external_idempotency_key_unique" ON "operation_receipts" USING btree ("external_idempotency_key");--> statement-breakpoint
CREATE INDEX "operation_receipts_agent_id_idx" ON "operation_receipts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "operation_receipts_approval_id_idx" ON "operation_receipts" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "operation_receipts_source_message_id_idx" ON "operation_receipts" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "operation_receipts_origin_attempt_id_idx" ON "operation_receipts" USING btree ("origin_attempt_id");--> statement-breakpoint
CREATE INDEX "operation_receipts_state_idx" ON "operation_receipts" USING btree ("state");--> statement-breakpoint
ALTER TABLE "operation_receipts" DROP COLUMN "worker_instance_id";--> statement-breakpoint
ALTER TABLE "operation_receipts" DROP COLUMN "model_tool_call_id";--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_browser_binding_check" CHECK ((
        ("approval_requests"."browser_runtime_instance_id" is null and "approval_requests"."browser_session_id" is null and "approval_requests"."browser_session_epoch" is null and "approval_requests"."browser_snapshot_marker" is null and "approval_requests"."browser_binding_hash" is null)
        or ("approval_requests"."browser_runtime_instance_id" is not null and "approval_requests"."browser_session_id" is not null and "approval_requests"."browser_session_epoch" is not null and "approval_requests"."browser_session_epoch" >= 0 and "approval_requests"."browser_snapshot_marker" is not null and "approval_requests"."browser_binding_hash" is not null)
      ));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_binding_invalidation_check" CHECK ((("approval_requests"."binding_invalidated_at" is null and "approval_requests"."binding_invalidation_reason" is null) or ("approval_requests"."binding_invalidated_at" is not null and "approval_requests"."binding_invalidation_reason" is not null and "approval_requests"."browser_binding_hash" is not null)));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_capability_payload_check" CHECK (("approval_requests"."consumed_at" is null or "approval_requests"."action_payload" is null)
        and ("approval_requests"."binding_invalidated_at" is null or "approval_requests"."action_payload" is null)
        and ("approval_requests"."status" <> 'rejected' or "approval_requests"."action_payload" is null));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_binding_bounds_check" CHECK (("approval_requests"."browser_session_id" is null or octet_length("approval_requests"."browser_session_id") between 1 and 256)
        and ("approval_requests"."browser_snapshot_marker" is null or octet_length("approval_requests"."browser_snapshot_marker") between 1 and 512)
        and ("approval_requests"."browser_binding_hash" is null or octet_length("approval_requests"."browser_binding_hash") between 1 and 256)
        and ("approval_requests"."binding_invalidation_reason" is null or octet_length("approval_requests"."binding_invalidation_reason") between 1 and 512));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_reason_check" CHECK ("tasks"."blocked_reason" is null or ("tasks"."status" = 'blocked' and "tasks"."blocked_reason" in ('user_input', 'budget', 'runtime_failure', 'approval_rejected', 'approval_expired', 'approval_outcome_unknown', 'operation_outcome_unknown', 'approval_action_failed', 'owner_inactive')));--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_canonical_version_check" CHECK ("operation_receipts"."canonical_version" > 0);--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_execution_kind_check" CHECK ((
        ("operation_receipts"."execution_kind" = 'task_step' and "operation_receipts"."task_id" is not null and "operation_receipts"."origin_attempt_id" is not null and "operation_receipts"."approval_id" is null and "operation_receipts"."source_message_id" is null)
        or ("operation_receipts"."execution_kind" = 'approved_action' and "operation_receipts"."task_id" is not null and "operation_receipts"."origin_attempt_id" is null and "operation_receipts"."approval_id" is not null and "operation_receipts"."source_message_id" is null)
        or ("operation_receipts"."execution_kind" = 'chat_turn' and "operation_receipts"."origin_attempt_id" is null and "operation_receipts"."approval_id" is null and "operation_receipts"."source_message_id" is not null)
      ));--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_replay_key_check" CHECK ((("operation_receipts"."side_effect_class" = 'read_only' and "operation_receipts"."replay_key" is null) or ("operation_receipts"."side_effect_class" <> 'read_only' and "operation_receipts"."replay_key" is not null)));--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_state_timestamps_check" CHECK ((
        ("operation_receipts"."state" = 'reserved' and "operation_receipts"."started_at" is null and "operation_receipts"."finished_at" is null)
        or ("operation_receipts"."state" = 'running' and "operation_receipts"."started_at" is not null and "operation_receipts"."finished_at" is null)
        or ("operation_receipts"."state" in ('succeeded', 'failed', 'unknown') and "operation_receipts"."finished_at" is not null)
      ));--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_reconciliation_check" CHECK ((
        ("operation_receipts"."reconciliation_decision" is null and "operation_receipts"."reconciliation_note" is null and "operation_receipts"."reconciliation_actor_id" is null and "operation_receipts"."reconciled_at" is null)
        or ("operation_receipts"."state" = 'unknown' and "operation_receipts"."reconciliation_decision" in ('confirmed_applied', 'confirmed_not_applied') and "operation_receipts"."reconciliation_note" is not null and "operation_receipts"."reconciliation_actor_id" is not null and "operation_receipts"."reconciled_at" is not null)
      ));--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_bounded_text_check" CHECK (octet_length("operation_receipts"."operation_key") <= 1024
        and ("operation_receipts"."replay_key" is null or octet_length("operation_receipts"."replay_key") <= 1024)
        and octet_length("operation_receipts"."logical_execution_id") <= 256
        and octet_length("operation_receipts"."tool_name") <= 256
        and octet_length("operation_receipts"."argument_hash") <= 256
        and ("operation_receipts"."external_idempotency_key" is null or octet_length("operation_receipts"."external_idempotency_key") <= 1024)
        and ("operation_receipts"."result_summary" is null or octet_length("operation_receipts"."result_summary") <= 4096)
        and ("operation_receipts"."failure_kind" is null or octet_length("operation_receipts"."failure_kind") <= 256)
        and ("operation_receipts"."sanitized_error" is null or octet_length("operation_receipts"."sanitized_error") <= 4096)
        and ("operation_receipts"."reconciliation_note" is null or octet_length("operation_receipts"."reconciliation_note") between 1 and 2000)
        and ("operation_receipts"."reconciliation_actor_id" is null or octet_length("operation_receipts"."reconciliation_actor_id") between 1 and 256));--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_bounded_result_data_check" CHECK ("operation_receipts"."result_data" is null or octet_length("operation_receipts"."result_data"::text) <= 16384);--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_side_effect_class_check" CHECK ("operation_receipts"."side_effect_class" in ('read_only', 'transactional', 'idempotent', 'at_most_once', 'approval_at_most_once'));
