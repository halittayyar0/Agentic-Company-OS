DO $migration$
DECLARE
  issues text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (SELECT 1 FROM agents a LEFT JOIN agents p ON p.id = a.parent_agent_id WHERE a.parent_agent_id IS NOT NULL AND p.id IS NULL) THEN issues := array_append(issues, 'agents.parent_agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM agents a LEFT JOIN agents c ON c.id = a.created_by_agent_id WHERE a.created_by_agent_id IS NOT NULL AND c.id IS NULL) THEN issues := array_append(issues, 'agents.created_by_agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM agents a LEFT JOIN tasks t ON t.id = a.current_task_id WHERE a.current_task_id IS NOT NULL AND t.id IS NULL) THEN issues := array_append(issues, 'agents.current_task_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM tasks t LEFT JOIN agents a ON a.id = t.owner_agent_id WHERE a.id IS NULL) THEN issues := array_append(issues, 'tasks.owner_agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM tasks t LEFT JOIN agents a ON a.id = t.assigned_by_agent_id WHERE t.assigned_by_agent_id IS NOT NULL AND a.id IS NULL) THEN issues := array_append(issues, 'tasks.assigned_by_agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM tasks t LEFT JOIN tasks p ON p.id = t.parent_task_id WHERE t.parent_task_id IS NOT NULL AND p.id IS NULL) THEN issues := array_append(issues, 'tasks.parent_task_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM messages m LEFT JOIN agents a ON a.id = m.agent_id WHERE a.id IS NULL) THEN issues := array_append(issues, 'messages.agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM messages m LEFT JOIN tasks t ON t.id = m.task_id WHERE m.task_id IS NOT NULL AND t.id IS NULL) THEN issues := array_append(issues, 'messages.task_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM activity_events e LEFT JOIN agents a ON a.id = e.agent_id WHERE e.agent_id IS NOT NULL AND a.id IS NULL) THEN issues := array_append(issues, 'activity_events.agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM activity_events e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.task_id IS NOT NULL AND t.id IS NULL) THEN issues := array_append(issues, 'activity_events.task_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM approval_requests r LEFT JOIN agents a ON a.id = r.agent_id WHERE a.id IS NULL) THEN issues := array_append(issues, 'approval_requests.agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM approval_requests r LEFT JOIN tasks t ON t.id = r.task_id WHERE t.id IS NULL) THEN issues := array_append(issues, 'approval_requests.task_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM usage_events u LEFT JOIN agents a ON a.id = u.agent_id WHERE a.id IS NULL) THEN issues := array_append(issues, 'usage_events.agent_id has orphan references'); END IF;
  IF EXISTS (SELECT 1 FROM usage_events u LEFT JOIN tasks t ON t.id = u.task_id WHERE u.task_id IS NOT NULL AND t.id IS NULL) THEN issues := array_append(issues, 'usage_events.task_id has orphan references'); END IF;

  IF EXISTS (SELECT 1 FROM agents WHERE status NOT IN ('idle', 'working', 'blocked', 'archived') OR model_mode NOT IN ('auto', 'manual') OR depth < 0) THEN issues := array_append(issues, 'agents has invalid status, model_mode, or depth'); END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE status NOT IN ('pending', 'planning', 'in_progress', 'awaiting_approval', 'blocked', 'completed', 'failed', 'cancelled') OR priority NOT IN ('low', 'normal', 'high', 'urgent') OR progress_percent NOT BETWEEN 0 AND 100 OR tokens_used < 0 OR step_attempts < 0 OR consecutive_failures < 0 OR estimated_cost_usd < 0) THEN issues := array_append(issues, 'tasks has invalid state or negative counters/cost'); END IF;
  IF EXISTS (SELECT 1 FROM messages WHERE role NOT IN ('user', 'agent', 'system')) THEN issues := array_append(issues, 'messages.role has unsupported values'); END IF;
  IF EXISTS (SELECT 1 FROM activity_events WHERE type NOT IN ('task_created', 'task_delegated', 'task_status_changed', 'subagent_created', 'progress_update', 'judge_review', 'approval_requested', 'approval_resolved', 'note', 'error', 'vm_command', 'vm_file') OR severity NOT IN ('info', 'warning', 'critical')) THEN issues := array_append(issues, 'activity_events has unsupported type or severity'); END IF;
  IF EXISTS (SELECT 1 FROM approval_requests WHERE category NOT IN ('spend', 'delete', 'publish', 'external_contact', 'other') OR status NOT IN ('pending', 'approved', 'rejected') OR amount_usd < 0) THEN issues := array_append(issues, 'approval_requests has unsupported state or negative amount'); END IF;
  IF EXISTS (SELECT 1 FROM usage_events WHERE kind NOT IN ('chat', 'task_step', 'judge') OR prompt_tokens < 0 OR completion_tokens < 0 OR total_tokens < 0 OR reported_cost_usd < 0) THEN issues := array_append(issues, 'usage_events has unsupported kind or negative usage/cost'); END IF;
  IF EXISTS (SELECT 1 FROM runtime_controls WHERE id <> 1 OR version < 1) THEN issues := array_append(issues, 'runtime_controls violates singleton/version invariants'); END IF;

  IF cardinality(issues) > 0 THEN
    RAISE EXCEPTION 'Migration 0008 preflight failed: %. Repair the listed rows on a backup and retry.', array_to_string(issues, '; ');
  END IF;
END
$migration$;
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_current_task_id_tasks_id_fk" FOREIGN KEY ("current_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_agent_id_agents_id_fk" FOREIGN KEY ("assigned_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "activity_events_agent_created_idx" ON "activity_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_events_task_created_idx" ON "activity_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "agents_parent_agent_idx" ON "agents" USING btree ("parent_agent_id");--> statement-breakpoint
CREATE INDEX "agents_current_task_idx" ON "agents" USING btree ("current_task_id");--> statement-breakpoint
CREATE INDEX "agents_created_by_agent_idx" ON "agents" USING btree ("created_by_agent_id");--> statement-breakpoint
CREATE INDEX "agents_scheduler_idx" ON "agents" USING btree ("is_active","status","run_lease_expires_at");--> statement-breakpoint
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_agent_created_idx" ON "approval_requests" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_task_created_idx" ON "approval_requests" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_status_expiry_idx" ON "approval_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "tasks_owner_updated_idx" ON "tasks" USING btree ("owner_agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_assigned_by_idx" ON "tasks" USING btree ("assigned_by_agent_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_created_idx" ON "tasks" USING btree ("parent_task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_status_created_idx" ON "tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tasks_scheduler_idx" ON "tasks" USING btree ("status","next_attempt_at","lease_expires_at","updated_at");--> statement-breakpoint
CREATE INDEX "messages_agent_created_idx" ON "messages" USING btree ("agent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "messages_task_created_idx" ON "messages" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_created_idx" ON "usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_events_agent_created_idx" ON "usage_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_task_created_idx" ON "usage_events" USING btree ("task_id","created_at");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_type_check" CHECK ("activity_events"."type" in ('task_created', 'task_delegated', 'task_status_changed', 'subagent_created', 'progress_update', 'judge_review', 'approval_requested', 'approval_resolved', 'note', 'error', 'vm_command', 'vm_file'));--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_severity_check" CHECK ("activity_events"."severity" in ('info', 'warning', 'critical'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_status_check" CHECK ("agents"."status" in ('idle', 'working', 'blocked', 'archived'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_model_mode_check" CHECK ("agents"."model_mode" in ('auto', 'manual'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_depth_check" CHECK ("agents"."depth" >= 0);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_category_check" CHECK ("approval_requests"."category" in ('spend', 'delete', 'publish', 'external_contact', 'other'));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" in ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_amount_check" CHECK ("approval_requests"."amount_usd" is null or "approval_requests"."amount_usd" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('pending', 'planning', 'in_progress', 'awaiting_approval', 'blocked', 'completed', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('low', 'normal', 'high', 'urgent'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_progress_percent_check" CHECK ("tasks"."progress_percent" between 0 and 100);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tokens_used_check" CHECK ("tasks"."tokens_used" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_step_attempts_check" CHECK ("tasks"."step_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_consecutive_failures_check" CHECK ("tasks"."consecutive_failures" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimated_cost_check" CHECK ("tasks"."estimated_cost_usd" is null or "tasks"."estimated_cost_usd" >= 0);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('user', 'agent', 'system'));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_kind_check" CHECK ("usage_events"."kind" in ('chat', 'task_step', 'judge'));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_prompt_tokens_check" CHECK ("usage_events"."prompt_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_completion_tokens_check" CHECK ("usage_events"."completion_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_total_tokens_check" CHECK ("usage_events"."total_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_reported_cost_check" CHECK ("usage_events"."reported_cost_usd" is null or "usage_events"."reported_cost_usd" >= 0);--> statement-breakpoint
ALTER TABLE "runtime_controls" ADD CONSTRAINT "runtime_controls_singleton_check" CHECK ("runtime_controls"."id" = 1);--> statement-breakpoint
ALTER TABLE "runtime_controls" ADD CONSTRAINT "runtime_controls_version_check" CHECK ("runtime_controls"."version" >= 1);
