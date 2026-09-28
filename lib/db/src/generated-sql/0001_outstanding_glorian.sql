ALTER TABLE "approval_requests" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "consumed_at" timestamp with time zone;