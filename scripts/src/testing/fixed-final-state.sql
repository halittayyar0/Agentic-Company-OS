BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH roster AS (
  SELECT id, owner_agent_id, status, blocked_reason, cycle_count, step_attempts,
    next_attempt_at, last_stepped_at, lease_owner IS NOT NULL AS leased
  FROM tasks WHERE id = :projectId OR parent_task_id = :projectId
  ORDER BY id LIMIT 11
), attempts AS (
  SELECT a.*, row_number() OVER (PARTITION BY a.task_id ORDER BY a.attempt_number DESC) AS rank
  FROM task_attempts a JOIN roster t ON t.id = a.task_id
), receipts AS (
  SELECT r.*, row_number() OVER (PARTITION BY r.task_id ORDER BY r.reserved_at DESC, r.id) AS rank
  FROM operation_receipts r JOIN roster t ON t.id = r.task_id
  WHERE r.execution_kind = 'task_step' AND r.tool_name = 'synthetic_fixture_write'
)
SELECT json_build_object(
  'kind', 'fixed_final_endurance_state',
  'projectId', :projectId,
  'sampledAt', CURRENT_TIMESTAMP,
  'tasks', (SELECT json_agg(json_build_object(
    'taskId',id,'agentId',owner_agent_id,
    'state',CASE WHEN status IN ('pending','planning','in_progress','blocked','completed','cancelled','failed','awaiting_approval') THEN status ELSE 'unknown' END,
    'blockedReason',CASE WHEN blocked_reason IS NULL THEN NULL WHEN blocked_reason IN ('user_input','budget','runtime_failure','approval_rejected','approval_expired','approval_outcome_unknown','operation_outcome_unknown','approval_action_failed','owner_inactive') THEN blocked_reason ELSE 'unknown' END,
    'cycles',cycle_count,'attempts',step_attempts,'leased',leased,
    'nextAttemptAt',next_attempt_at,'lastSteppedAt',last_stepped_at
  ) ORDER BY id) FROM roster),
  'attempts', (SELECT json_agg(json_build_object(
    'id',id,'taskId',task_id,'agentId',agent_id,'cycle',cycle_number,'number',attempt_number,
    'state',state,'startedAt',started_at,'finishedAt',finished_at,
    'failureKind',CASE WHEN failure_kind IS NULL THEN NULL WHEN failure_kind IN ('emergency_stop','lease_lost','lease_expired','runtime','model_routes_exhausted','provider_setup_required','chatgpt_plan','owner_inactive') THEN failure_kind ELSE 'other' END
  ) ORDER BY task_id,attempt_number) FROM attempts WHERE rank <= 3),
  'receipts', (SELECT json_agg(json_build_object(
    'id',id,'taskId',task_id,'originAttemptId',origin_attempt_id,'state',state,
    'reservedAt',reserved_at,'finishedAt',finished_at,
    'invocations',(SELECT json_agg(json_build_object(
      'id',i.id,'attemptId',i.attempt_id,'state',i.state,'effectStartedAt',i.effect_started_at,'finishedAt',i.finished_at
    ) ORDER BY i.claimed_at) FROM operation_invocations i WHERE i.receipt_id=r.id)
  ) ORDER BY task_id,reserved_at) FROM receipts r WHERE rank <= 3)
);
ROLLBACK;
