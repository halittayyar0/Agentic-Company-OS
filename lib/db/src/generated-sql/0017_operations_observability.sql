ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_type_check";--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD COLUMN "sampled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD COLUMN "sampled_by_instance_id" text;--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD COLUMN "runtime_truth_state" text;--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD COLUMN "provider_metrics_coverage" text DEFAULT 'partial' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD CONSTRAINT "runtime_health_samples_sampled_by_instance_id_runtime_instances_id_fk" FOREIGN KEY ("sampled_by_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_operations_id_idx" ON "activity_events" USING btree ("id") WHERE "activity_events"."type" = 'operations_changed';--> statement-breakpoint
CREATE INDEX "activity_events_operations_task_id_idx" ON "activity_events" USING btree ("task_id","id") WHERE "activity_events"."type" = 'operations_changed';--> statement-breakpoint
CREATE INDEX "operation_invocations_receipt_claimed_idx" ON "operation_invocations" USING btree ("receipt_id","claimed_at","id");--> statement-breakpoint
CREATE INDEX "operation_receipts_task_reserved_idx" ON "operation_receipts" USING btree ("task_id","reserved_at","id");--> statement-breakpoint
CREATE INDEX "runtime_instances_role_heartbeat_idx" ON "runtime_instances" USING btree ("role","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "task_attempts_task_started_idx" ON "task_attempts" USING btree ("task_id","started_at","id");--> statement-breakpoint
CREATE INDEX "task_attempts_state_heartbeat_idx" ON "task_attempts" USING btree ("state","last_heartbeat_at");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_type_check" CHECK ("activity_events"."type" in ('task_created', 'task_delegated', 'task_status_changed', 'subagent_created', 'progress_update', 'judge_review', 'approval_requested', 'approval_resolved', 'note', 'error', 'vm_command', 'vm_file', 'operations_changed'));--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD CONSTRAINT "runtime_health_samples_truth_state_check" CHECK ("runtime_health_samples"."runtime_truth_state" is null or "runtime_health_samples"."runtime_truth_state" in ('live', 'degraded', 'stale', 'offline', 'emergency_stopped', 'local_demo'));--> statement-breakpoint
ALTER TABLE "runtime_health_samples" ADD CONSTRAINT "runtime_health_samples_provider_coverage_check" CHECK ("runtime_health_samples"."provider_metrics_coverage" in ('partial', 'complete'));