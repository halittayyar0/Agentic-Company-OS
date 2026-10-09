CREATE TABLE "task_creation_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"task_id" integer,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_creation_requests_hash_check" CHECK ("task_creation_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "task_creation_requests_outcome_check" CHECK (coalesce(
    ("task_creation_requests"."state" = 'created' AND "task_creation_requests"."task_id" > 0 AND "task_creation_requests"."failure_code" IS NULL)
    OR ("task_creation_requests"."state" = 'rejected' AND "task_creation_requests"."task_id" IS NULL AND "task_creation_requests"."failure_code" IN ('EMERGENCY_STOP_ACTIVE','AGENT_UNAVAILABLE','RUNTIME_CAPACITY_EXCEEDED','EXECUTION_POLICY_DENIED')),
    false))
);
