CREATE TABLE "task_budget_resume_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"root_task_id" integer NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_budget_resume_requests_task_check" CHECK ("task_budget_resume_requests"."task_id" > 0 AND "task_budget_resume_requests"."root_task_id" > 0),
	CONSTRAINT "task_budget_resume_requests_hash_check" CHECK ("task_budget_resume_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "task_budget_resume_requests_response_check" CHECK (jsonb_typeof("task_budget_resume_requests"."response") = 'object' AND coalesce("task_budget_resume_requests"."response"->>'outcome' IN ('accepted','rejected'), false) AND octet_length("task_budget_resume_requests"."response"::text) <= 32768)
);
--> statement-breakpoint
CREATE INDEX "task_budget_resume_requests_task_created_idx" ON "task_budget_resume_requests" USING btree ("task_id","created_at");