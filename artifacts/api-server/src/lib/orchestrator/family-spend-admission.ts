import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { WorkspaceLocale } from "../workspace-locale";
import { toolMessage } from "./tool-localization";
import { tokenUsageEvidence } from "../usage-coverage";
import { unreportedTokenUsageBlockReason } from "./task-budget-policy";

/** A transaction reader keeps admission and its queue transition in one scope. */
export type SpendReaderClient = Pick<typeof db, "select" | "execute">;
export type InferenceAccountingStatus = "pending" | "recovery_required" | null;

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : fallback;
}

export function familySpendLimits() {
  return {
    tokens: Math.max(
      1,
      Math.floor(positive("MAX_TASK_FAMILY_TOKENS", 250_000)),
    ),
    cost: positive("MAX_TASK_FAMILY_REPORTED_COST_USD", 3),
    dailyTokens: Math.max(
      1,
      Math.floor(positive("MAX_RECURRING_FAMILY_DAILY_TOKENS", 500_000)),
    ),
    dailyCost: positive("MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD", 8),
  };
}

interface FamilyRow {
  accounting_id: string | null;
  accounting_recovery: boolean | null;
  roots: number;
  root_id: number | null;
  recurring: boolean | null;
  lifetime_tokens: string;
  lifetime_cost: string | null;
  lifetime_rows: string;
  lifetime_unknown: string;
  lifetime_token_reported: string;
  legacy_incomplete_members: string;
  legacy_incomplete_token_members: string;
  cycle_tokens: string;
  cycle_cost: string | null;
  cycle_rows: string;
  cycle_unknown: string;
  cycle_token_reported: string;
  day_tokens: string;
  day_cost: string | null;
  day_rows: string;
  day_unknown: string;
  day_token_reported: string;
}

function evidence(
  tokens: string,
  cost: string | null,
  rows: string,
  unknown: string,
  legacy = "0",
  tokenReported = "0",
  legacyTokens = "0",
) {
  const tokensUsed = Number(tokens),
    count = Number(rows),
    missing = Number(unknown),
    materialized = Number(legacy);
  if (
    ![tokensUsed, count, missing, materialized].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    (cost !== null && (!Number.isFinite(Number(cost)) || Number(cost) < 0))
  ) {
    throw new Error("Invalid task family spend evidence");
  }
  const costCoverage =
    materialized > 0
      ? cost === null
        ? "unknown"
        : "partial"
      : count === 0
        ? tokensUsed > 0
          ? "unknown"
          : "no_usage"
        : missing === 0
          ? "complete"
          : cost === null
            ? "unknown"
            : "partial";
  return {
    tokensUsed,
    reportedCostUsd: cost,
    costCoverage,
    ...tokenUsageEvidence(count, tokenReported, Number(legacyTokens) > 0),
  };
}

/** One statement reads the rooted graph and its receipt ledger consistently.
 * UNION terminates corrupt parent cycles. Finite work uses the maximum of each
 * member's aggregate and ledger; recurring work uses the root's cycle boundary.
 * This denies further inference after recorded spend, not in-flight billing. */
export async function readFamilySpendAdmission(
  taskId: number,
  locale: WorkspaceLocale,
  now = new Date(),
  client: SpendReaderClient = db,
  ignoreInferenceAttemptId?: string,
) {
  const dayStart = new Date(now.getTime() - 86_400_000);
  const result = await client.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_task_id FROM tasks WHERE id = ${taskId}
      UNION
      SELECT t.id, t.parent_task_id FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
    ), root AS (
      SELECT t.id, t.autonomy_mode, coalesce(t.last_cycle_completed_at, t.created_at) AS cycle_start
      FROM tasks t JOIN ancestors a ON t.id = a.id WHERE t.parent_task_id IS NULL
    ), family AS (
      SELECT t.id, t.tokens_used, t.estimated_cost_usd FROM tasks t JOIN root r ON t.id = r.id
      UNION
      SELECT t.id, t.tokens_used, t.estimated_cost_usd FROM tasks t JOIN family f ON t.parent_task_id = f.id
    ), receipts AS (
      SELECT f.id,
        coalesce(sum(u.total_tokens), 0) AS all_tokens,
        sum(u.reported_cost_usd) AS all_cost,
        count(u.id) AS all_rows,
        count(u.id) FILTER (WHERE u.usage_reported IS TRUE) AS all_token_reported,
        count(u.id) FILTER (WHERE u.reported_cost_usd IS NULL) AS all_unknown,
        coalesce(sum(u.total_tokens) FILTER (WHERE u.created_at >= r.cycle_start), 0) AS cycle_tokens,
        sum(u.reported_cost_usd) FILTER (WHERE u.created_at >= r.cycle_start) AS cycle_cost,
        count(u.id) FILTER (WHERE u.created_at >= r.cycle_start) AS cycle_rows,
        count(u.id) FILTER (WHERE u.created_at >= r.cycle_start AND u.usage_reported IS TRUE) AS cycle_token_reported,
        count(u.id) FILTER (WHERE u.created_at >= r.cycle_start AND u.reported_cost_usd IS NULL) AS cycle_unknown,
        coalesce(sum(u.total_tokens) FILTER (WHERE u.created_at >= ${dayStart}), 0) AS day_tokens,
        sum(u.reported_cost_usd) FILTER (WHERE u.created_at >= ${dayStart}) AS day_cost,
        count(u.id) FILTER (WHERE u.created_at >= ${dayStart}) AS day_rows,
        count(u.id) FILTER (WHERE u.created_at >= ${dayStart} AND u.usage_reported IS TRUE) AS day_token_reported,
        count(u.id) FILTER (WHERE u.created_at >= ${dayStart} AND u.reported_cost_usd IS NULL) AS day_unknown
      FROM family f CROSS JOIN root r
      LEFT JOIN effective_usage_events u ON u.task_id = f.id AND u.kind IN ('task_step', 'judge', 'chat')
      GROUP BY f.id
    ), unsettled AS (
      SELECT i.id,i.state,i.request_deadline_at,i.created_at,i.evidence_conflict_at
      FROM inference_attempts i
      WHERE (i.state IN ('reserved','dispatched','uncertain') OR i.evidence_conflict_at IS NOT NULL)
        AND (i.scope_key = 'task:' || (SELECT id FROM root LIMIT 1)::text
          OR i.agent_id = (SELECT owner_agent_id FROM tasks WHERE id=${taskId}))
        AND ${ignoreInferenceAttemptId ? sql`i.id <> ${ignoreInferenceAttemptId}::uuid` : sql`true`}
    )
    SELECT (SELECT count(*)::int FROM root) AS roots,
      (SELECT id::text FROM unsettled ORDER BY created_at,id LIMIT 1) AS accounting_id,
      (SELECT state='uncertain' OR evidence_conflict_at IS NOT NULL OR request_deadline_at <= ${now} FROM unsettled ORDER BY created_at,id LIMIT 1) AS accounting_recovery,
      (SELECT id FROM root LIMIT 1) AS root_id,
      (SELECT autonomy_mode = 'continuous' FROM root LIMIT 1) AS recurring,
      coalesce(sum(greatest(f.tokens_used, p.all_tokens)), 0)::text AS lifetime_tokens,
      sum(greatest(nullif(f.estimated_cost_usd, 0), p.all_cost))::text AS lifetime_cost,
      coalesce(sum(p.all_rows), 0)::text AS lifetime_rows,
      coalesce(sum(p.all_token_reported), 0)::text AS lifetime_token_reported,
      coalesce(sum(p.all_unknown), 0)::text AS lifetime_unknown,
      count(*) FILTER (WHERE f.tokens_used > p.all_tokens OR f.estimated_cost_usd > coalesce(p.all_cost, 0))::text AS legacy_incomplete_members,
      count(*) FILTER (WHERE f.tokens_used > p.all_tokens)::text AS legacy_incomplete_token_members,
      coalesce(sum(p.cycle_tokens), 0)::text AS cycle_tokens,
      sum(p.cycle_cost)::text AS cycle_cost,
      coalesce(sum(p.cycle_rows), 0)::text AS cycle_rows,
      coalesce(sum(p.cycle_token_reported), 0)::text AS cycle_token_reported,
      coalesce(sum(p.cycle_unknown), 0)::text AS cycle_unknown,
      coalesce(sum(p.day_tokens), 0)::text AS day_tokens,
      sum(p.day_cost)::text AS day_cost,
      coalesce(sum(p.day_rows), 0)::text AS day_rows,
      coalesce(sum(p.day_token_reported), 0)::text AS day_token_reported,
      coalesce(sum(p.day_unknown), 0)::text AS day_unknown
    FROM family f JOIN receipts p ON p.id = f.id
  `);
  const row = result.rows[0] as unknown as FamilyRow | undefined;
  if (
    !row ||
    row.roots !== 1 ||
    !Number.isSafeInteger(row.root_id) ||
    Number(row.root_id) <= 0
  ) {
    throw new Error("Inference requires a valid rooted task family");
  }
  const rootTaskId = row.root_id!;
  const accountingStatus: InferenceAccountingStatus = row.accounting_id
    ? row.accounting_recovery
      ? "recovery_required"
      : "pending"
    : null;
  const limits = familySpendLimits();
  const current = row.recurring
    ? evidence(
        row.cycle_tokens,
        row.cycle_cost,
        row.cycle_rows,
        row.cycle_unknown,
        "0",
        row.cycle_token_reported,
      )
    : evidence(
        row.lifetime_tokens,
        row.lifetime_cost,
        row.lifetime_rows,
        row.lifetime_unknown,
        row.legacy_incomplete_members,
        row.lifetime_token_reported,
        row.legacy_incomplete_token_members,
      );
  const currentReason =
    row.accounting_id !== null
      ? toolMessage(
          locale,
          row.accounting_recovery
            ? "inferenceAccountingRecovery"
            : "inferenceAccountingPending",
          { id: row.accounting_id },
        )
      : current.tokensUsed >= limits.tokens
        ? toolMessage(locale, "schedulerFamilyTokenBudget", {
            rootTaskId,
            used: current.tokensUsed,
            limit: limits.tokens,
          })
        : Number(current.reportedCostUsd ?? 0) >= limits.cost
          ? toolMessage(locale, "schedulerFamilyCostBudget", {
              rootTaskId,
              used: current.reportedCostUsd!,
              limit: limits.cost,
            })
          : unreportedTokenUsageBlockReason(current.tokenUsageCoverage, locale);
  if (currentReason || !row.recurring)
    return {
      ...current,
      reason: currentReason,
      rootTaskId,
      accountingStatus,
      inferenceAttemptId: row.accounting_id,
      usageSource: row.recurring
        ? "task_family_current_cycle"
        : "task_family_lifetime",
    };
  const daily = evidence(
    row.day_tokens,
    row.day_cost,
    row.day_rows,
    row.day_unknown,
    "0",
    row.day_token_reported,
  );
  return {
    ...daily,
    rootTaskId,
    accountingStatus,
    inferenceAttemptId: row.accounting_id,
    usageSource: "task_family_rolling_24h",
    reason:
      daily.tokensUsed >= limits.dailyTokens
        ? toolMessage(locale, "schedulerFamilyDailyTokenBudget", {
            rootTaskId,
            used: daily.tokensUsed,
            limit: limits.dailyTokens,
          })
        : Number(daily.reportedCostUsd ?? 0) >= limits.dailyCost
          ? toolMessage(locale, "schedulerFamilyDailyCostBudget", {
              rootTaskId,
              used: daily.reportedCostUsd!,
              limit: limits.dailyCost,
            })
          : unreportedTokenUsageBlockReason(daily.tokenUsageCoverage, locale),
  };
}
