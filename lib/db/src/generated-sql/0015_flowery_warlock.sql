CREATE TABLE "operation_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_key" text NOT NULL,
	"task_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"attempt_id" text NOT NULL,
	"worker_instance_id" text NOT NULL,
	"side_effect_class" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"model_tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"argument_hash" text NOT NULL,
	"external_idempotency_key" text,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_summary" text,
	"failure_kind" text,
	"sanitized_error" text,
	CONSTRAINT "operation_receipts_side_effect_class_check" CHECK ("operation_receipts"."side_effect_class" in ('read_only', 'idempotent', 'approval_at_most_once')),
	CONSTRAINT "operation_receipts_state_check" CHECK ("operation_receipts"."state" in ('reserved', 'running', 'succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "runtime_health_samples" (
	"bucket_at" timestamp with time zone PRIMARY KEY NOT NULL,
	"healthy_worker_count" integer DEFAULT 0 NOT NULL,
	"stale_worker_count" integer DEFAULT 0 NOT NULL,
	"scheduler_tick_age_ms" integer,
	"due_queue_depth" integer DEFAULT 0 NOT NULL,
	"oldest_due_age_ms" integer,
	"active_task_count" integer DEFAULT 0 NOT NULL,
	"sleeping_task_count" integer DEFAULT 0 NOT NULL,
	"recovering_task_count" integer DEFAULT 0 NOT NULL,
	"blocked_task_count" integer DEFAULT 0 NOT NULL,
	"approval_waiting_task_count" integer DEFAULT 0 NOT NULL,
	"provider_success_count" integer DEFAULT 0 NOT NULL,
	"provider_error_count" integer DEFAULT 0 NOT NULL,
	"provider_p50_latency_ms" integer,
	"provider_p95_latency_ms" integer,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"lost_lease_count" integer DEFAULT 0 NOT NULL,
	"task_tokens" integer DEFAULT 0 NOT NULL,
	"reported_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "runtime_health_samples_nonnegative_counts_check" CHECK ("runtime_health_samples"."healthy_worker_count" >= 0 and "runtime_health_samples"."stale_worker_count" >= 0 and "runtime_health_samples"."due_queue_depth" >= 0 and "runtime_health_samples"."active_task_count" >= 0 and "runtime_health_samples"."sleeping_task_count" >= 0 and "runtime_health_samples"."recovering_task_count" >= 0 and "runtime_health_samples"."blocked_task_count" >= 0 and "runtime_health_samples"."approval_waiting_task_count" >= 0 and "runtime_health_samples"."provider_success_count" >= 0 and "runtime_health_samples"."provider_error_count" >= 0 and "runtime_health_samples"."recovery_count" >= 0 and "runtime_health_samples"."lost_lease_count" >= 0 and "runtime_health_samples"."task_tokens" >= 0),
	CONSTRAINT "runtime_health_samples_nonnegative_ages_check" CHECK ("runtime_health_samples"."scheduler_tick_age_ms" is null or "runtime_health_samples"."scheduler_tick_age_ms" >= 0),
	CONSTRAINT "runtime_health_samples_nonnegative_oldest_due_age_check" CHECK ("runtime_health_samples"."oldest_due_age_ms" is null or "runtime_health_samples"."oldest_due_age_ms" >= 0),
	CONSTRAINT "runtime_health_samples_nonnegative_p50_latency_check" CHECK ("runtime_health_samples"."provider_p50_latency_ms" is null or "runtime_health_samples"."provider_p50_latency_ms" >= 0),
	CONSTRAINT "runtime_health_samples_nonnegative_p95_latency_check" CHECK ("runtime_health_samples"."provider_p95_latency_ms" is null or "runtime_health_samples"."provider_p95_latency_ms" >= 0),
	CONSTRAINT "runtime_health_samples_latency_percentiles_check" CHECK ("runtime_health_samples"."provider_p50_latency_ms" is null or "runtime_health_samples"."provider_p95_latency_ms" is null or "runtime_health_samples"."provider_p50_latency_ms" <= "runtime_health_samples"."provider_p95_latency_ms"),
	CONSTRAINT "runtime_health_samples_reported_cost_check" CHECK ("runtime_health_samples"."reported_cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"state" text DEFAULT 'starting' NOT NULL,
	"hostname" text NOT NULL,
	"process_id" integer NOT NULL,
	"build_version" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draining_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"scheduler_enabled" boolean DEFAULT false NOT NULL,
	"last_scheduler_tick_at" timestamp with time zone,
	CONSTRAINT "runtime_instances_role_check" CHECK ("runtime_instances"."role" in ('api', 'worker', 'combined')),
	CONSTRAINT "runtime_instances_state_check" CHECK ("runtime_instances"."state" in ('starting', 'healthy', 'draining', 'stale', 'stopped')),
	CONSTRAINT "runtime_instances_process_id_check" CHECK ("runtime_instances"."process_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "task_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"worker_instance_id" text NOT NULL,
	"lease_owner" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"cycle_number" integer NOT NULL,
	"state" text DEFAULT 'claimed' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"model_id" text,
	"provider" text,
	"failure_kind" text,
	"sanitized_error" text,
	"recovery_of_attempt_id" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"reported_cost_usd" numeric(12, 6),
	CONSTRAINT "task_attempts_state_check" CHECK ("task_attempts"."state" in ('claimed', 'running', 'succeeded', 'retrying', 'blocked', 'lost')),
	CONSTRAINT "task_attempts_attempt_number_check" CHECK ("task_attempts"."attempt_number" > 0),
	CONSTRAINT "task_attempts_cycle_number_check" CHECK ("task_attempts"."cycle_number" >= 0),
	CONSTRAINT "task_attempts_prompt_tokens_check" CHECK ("task_attempts"."prompt_tokens" >= 0),
	CONSTRAINT "task_attempts_completion_tokens_check" CHECK ("task_attempts"."completion_tokens" >= 0),
	CONSTRAINT "task_attempts_total_tokens_check" CHECK ("task_attempts"."total_tokens" >= 0),
	CONSTRAINT "task_attempts_reported_cost_check" CHECK ("task_attempts"."reported_cost_usd" is null or "task_attempts"."reported_cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_attempt_id_task_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."task_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_worker_instance_id_runtime_instances_id_fk" FOREIGN KEY ("worker_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_worker_instance_id_runtime_instances_id_fk" FOREIGN KEY ("worker_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_recovery_of_attempt_id_task_attempts_id_fk" FOREIGN KEY ("recovery_of_attempt_id") REFERENCES "public"."task_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_receipts_operation_key_unique" ON "operation_receipts" USING btree ("operation_key");--> statement-breakpoint
CREATE INDEX "operation_receipts_task_id_idx" ON "operation_receipts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "operation_receipts_attempt_id_idx" ON "operation_receipts" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "runtime_health_samples_bucket_idx" ON "runtime_health_samples" USING btree ("bucket_at");--> statement-breakpoint
CREATE INDEX "runtime_instances_last_heartbeat_idx" ON "runtime_instances" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "runtime_instances_state_idx" ON "runtime_instances" USING btree ("state");--> statement-breakpoint
CREATE INDEX "task_attempts_task_id_idx" ON "task_attempts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_attempts_worker_instance_id_idx" ON "task_attempts" USING btree ("worker_instance_id");--> statement-breakpoint
CREATE INDEX "task_attempts_state_idx" ON "task_attempts" USING btree ("state");