CREATE TABLE "task_answer_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"question_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_answer_requests_task_check" CHECK ("task_answer_requests"."task_id" > 0),
	CONSTRAINT "task_answer_requests_hash_check" CHECK ("task_answer_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "task_answer_requests_response_check" CHECK (jsonb_typeof("task_answer_requests"."response") = 'object' AND coalesce("task_answer_requests"."response"->>'outcome' IN ('accepted','rejected'), false))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "user_input_question_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "user_input_question" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "user_input_owner_agent_id" integer;--> statement-breakpoint
CREATE INDEX "task_answer_requests_task_created_idx" ON "task_answer_requests" USING btree ("task_id","created_at");
--> statement-breakpoint
-- Upgrade only a recorded, still-unanswered question from the current owner.
-- Generic last_error text and waits without question evidence stay unanswerable.
WITH latest_question AS (
  SELECT DISTINCT ON (task_id) id, task_id, agent_id, detail->>'question' AS question,
    jsonb_typeof(detail->'question') AS question_type
  FROM activity_events
  WHERE type = 'note' AND detail ? 'question'
  ORDER BY task_id, id DESC
)
UPDATE tasks t SET user_input_question_id = gen_random_uuid(),
  user_input_question = q.question, user_input_owner_agent_id = q.agent_id
FROM latest_question q
WHERE t.id = q.task_id AND t.owner_agent_id = q.agent_id
  AND t.status = 'blocked' AND t.blocked_reason = 'user_input'
  AND q.question_type = 'string' AND length(btrim(q.question)) > 0
  -- The previous writer sliced at 1000 JavaScript UTF-16 units. A value at
  -- that boundary may be truncated. Do not revive it, or fall back to an older
  -- question. Count supplementary-plane characters as two UTF-16 units.
  AND length(regexp_replace(q.question, U&'[\+010000-\+10FFFF]', 'xx', 'g')) < 1000
  AND NOT EXISTS (
    SELECT 1 FROM activity_events a WHERE a.task_id = t.id AND a.id > q.id
      AND a.detail->>'runtimeEvent' = 'task_resumed_with_user_input'
  );
