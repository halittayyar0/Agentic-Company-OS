import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { GetInferenceAccountingStatusResponse } from "@workspace/api-zod";

/** One statement observes scope, markers and their keyed usage receipts.
 * No provider, lease mutation, task resume or accounting reconciliation. */
export async function readInferenceAccountingStatus(
  scopeType: "task" | "agent",
  scopeId: number,
  now = new Date(),
) {
  if (
    !Number.isSafeInteger(scopeId) ||
    scopeId < 1 ||
    scopeId > 2147483647 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Invalid accounting scope");
  const target =
    scopeType === "task"
      ? sql`SELECT t.owner_agent_id AS agent_id, (SELECT id FROM root LIMIT 1) AS root_id,
        (SELECT count(*)::int FROM root) AS roots FROM tasks t WHERE t.id=${scopeId}`
      : sql`SELECT id AS agent_id, NULL::integer AS root_id, 0::integer AS roots FROM agents WHERE id=${scopeId}`;
  const matches =
    scopeType === "task"
      ? sql`i.scope_key = 'task:' || t.root_id::text OR (i.agent_id=t.agent_id AND (i.state IN ('reserved','dispatched','uncertain') OR i.evidence_conflict_at IS NOT NULL))`
      : sql`i.agent_id=t.agent_id`;
  const result = await db.execute(sql`WITH RECURSIVE ancestors AS (
      SELECT id,parent_task_id FROM tasks WHERE id=${scopeType === "task" ? scopeId : -1}
      UNION SELECT t.id,t.parent_task_id FROM tasks t JOIN ancestors a ON t.id=a.parent_task_id
    ), root AS (SELECT id FROM ancestors WHERE parent_task_id IS NULL),
    target AS (${target}), matched AS (
      SELECT i.*, u.id AS usage_id, u.prompt_tokens, u.completion_tokens, u.total_tokens,
        u.usage_reported, u.reported_cost_usd,
        (i.state IN ('reserved','dispatched','uncertain') OR i.evidence_conflict_at IS NOT NULL) AS unsettled
      FROM inference_attempts i CROSS JOIN target t
      LEFT JOIN effective_usage_events u ON u.ordinary_inference_id=i.id
      WHERE ${matches}
    ) SELECT t.root_id, t.roots,
      (SELECT count(*)::int FROM matched WHERE unsettled) AS unsettled_count,
      (SELECT count(*) > 20 FROM matched) AS has_more,
      CASE WHEN EXISTS(SELECT 1 FROM matched WHERE unsettled AND (state='uncertain' OR evidence_conflict_at IS NOT NULL OR request_deadline_at <= ${now})) THEN 'recovery_required'
        WHEN EXISTS(SELECT 1 FROM matched WHERE unsettled) THEN 'pending' ELSE 'clear' END AS status,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'agentId', m.agent_id, 'taskId', m.task_id,
        'modelId', m.model_id, 'provider', m.provider, 'kind', m.kind, 'state', CASE WHEN m.evidence_conflict_at IS NOT NULL THEN 'uncertain' ELSE m.state END,
        'createdAt', floor(extract(epoch FROM m.created_at)*1000)::bigint,
        'requestDeadlineAt', floor(extract(epoch FROM m.request_deadline_at)*1000)::bigint,
        'dispatchedAt', floor(extract(epoch FROM m.dispatched_at)*1000)::bigint,
        'settledAt', floor(extract(epoch FROM m.settled_at)*1000)::bigint,
        'usage', CASE WHEN m.usage_id IS NULL THEN NULL ELSE jsonb_build_object(
          'promptTokens', m.prompt_tokens, 'completionTokens', m.completion_tokens,
          'totalTokens', m.total_tokens, 'usageReported', m.usage_reported,
          'reportedCostUsd', m.reported_cost_usd::text) END
      ) ORDER BY m.unsettled DESC,m.created_at DESC,m.id) FROM (
        SELECT * FROM matched ORDER BY unsettled DESC,created_at DESC,id LIMIT 20
      ) m), '[]'::jsonb) AS attempts FROM target t`);
  const row = result.rows[0];
  if (!row) return null;
  if (scopeType === "task" && row.roots !== 1)
    throw new Error("Invalid accounting task family");
  return GetInferenceAccountingStatusResponse.strict().parse({
    scopeType,
    scopeId,
    rootTaskId: row.root_id,
    status: row.status,
    observedAt: now.getTime(),
    unsettledCount: row.unsettled_count,
    hasMore: row.has_more,
    attempts: row.attempts,
  });
}
