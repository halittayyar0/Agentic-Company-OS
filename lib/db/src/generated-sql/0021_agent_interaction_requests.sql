CREATE TABLE "agent_interaction_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_interaction_requests_agent_check" CHECK ("agent_interaction_requests"."agent_id" > 0),
	CONSTRAINT "agent_interaction_requests_hash_check" CHECK ("agent_interaction_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_interaction_requests_response_check" CHECK (jsonb_typeof("agent_interaction_requests"."response") = 'object' AND coalesce("agent_interaction_requests"."response"->>'deliveryState' IN ('complete','unconfirmed','rejected'), false))
);
--> statement-breakpoint
CREATE INDEX "agent_interaction_requests_agent_created_idx" ON "agent_interaction_requests" USING btree ("agent_id","created_at");