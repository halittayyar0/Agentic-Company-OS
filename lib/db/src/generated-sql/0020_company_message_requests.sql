CREATE TABLE "company_message_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_message_requests_hash_check" CHECK ("company_message_requests"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "company_message_requests_response_check" CHECK (jsonb_typeof("company_message_requests"."response") = 'object' AND coalesce("company_message_requests"."response"->>'deliveryState' IN ('complete', 'unconfirmed'), false))
);
