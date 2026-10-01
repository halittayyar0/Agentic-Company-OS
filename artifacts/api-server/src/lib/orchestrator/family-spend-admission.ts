import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { WorkspaceLocale } from "../workspace-locale";
import { toolMessage } from "./tool-localization";

/** A transaction reader keeps admission and its queue transition in one scope. */
export type SpendReaderClient = Pick<typeof db, "select" | "execute">;

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
  roots: number;
  root_id: number | null;
  recurring: boolean | null;
  lifetime_tokens: string;
  lifetime_cost: string | null;
  lifetime_rows: string;
  lifetime_unknown: string;
  legacy_incomplete_members: string;
  cycle_tokens: string;
  cycle_cost: string | null;
  cycle_rows: string;
  cycle_unknown: string;
  day_tokens: string;
  day_cost: string | null;
  day_rows: string;
  day_unknown: string;
}

function evidence(
  tokens: string,
  cost: string | null,
  rows: string,
  unknown: string,
  legacy = "0",
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
  return { tokensUsed, reportedCostUsd: cost, costCoverage };
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
        count(u.id) FILTER (WHERE u.reported_cost_usd IS NULL) AS all_unknown,
        coalesce(sum(u.total_tokens) FILTER (WHERE u.created_at >= r.cycle_start), 0) AS cycle_tokens,
        sum(u.reported_cost_usd) FILTER (WHERE u.created_at >= r.cycle_start) AS cycle_cost,
        count(u.id) FILTER (WHERE u.created_at >= r.cycle_start) AS cycle_rows,
        count(u.id) FILTER (WHERE u.created_at >= r.cycle_start AND u.reported_cost_usd IS NULL) AS cycle_unknown,
        coalesce(sum(u.total_tokens) FILTER (WHERE u.created_at >= ${dayStart}), 0) AS day_tokens,
        sum(u.reported_cost_usd) FILTER (WHERE u.created_at >= ${dayStart}) AS day_cost,
        count(u.id) FILTER (WHERE u.created_at >= ${dayStart}) AS day_rows,
        count(u.id) FILTER (WHERE u.created_at >= ${dayStart} AND u.reported_cost_usd IS NULL) AS day_unknown
      FROM family f CROSS JOIN root r
      LEFT JOIN usage_events u ON u.task_id = f.id AND u.kind IN ('task_step', 'judge')
      GROUP BY f.id
    )
    SELECT (SELECT count(*)::int FROM root) AS roots,
      (SELECT id FROM root LIMIT 1) AS root_id,
      (SELECT autonomy_mode = 'continuous' FROM root LIMIT 1) AS recurring,
      coalesce(sum(greatest(f.tokens_used, p.all_tokens)), 0)::text AS lifetime_tokens,
      sum(greatest(nullif(f.estimated_cost_usd, 0), p.all_cost))::text AS lifetime_cost,
      coalesce(sum(p.all_rows), 0)::text AS lifetime_rows,
      coalesce(sum(p.all_unknown), 0)::text AS lifetime_unknown,
      count(*) FILTER (WHERE f.tokens_used > p.all_tokens OR f.estimated_cost_usd > coalesce(p.all_cost, 0))::text AS legacy_incomplete_members,
      coalesce(sum(p.cycle_tokens), 0)::text AS cycle_tokens,
      sum(p.cycle_cost)::text AS cycle_cost,
      coalesce(sum(p.cycle_rows), 0)::text AS cycle_rows,
      coalesce(sum(p.cycle_unknown), 0)::text AS cycle_unknown,
      coalesce(sum(p.day_tokens), 0)::text AS day_tokens,
      sum(p.day_cost)::text AS day_cost,
      coalesce(sum(p.day_rows), 0)::text AS day_rows,
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
  const limits = familySpendLimits();
  const current = row.recurring
    ? evidence(
        row.cycle_tokens,
        row.cycle_cost,
        row.cycle_rows,
        row.cycle_unknown,
      )
    : evidence(
        row.lifetime_tokens,
        row.lifetime_cost,
        row.lifetime_rows,
        row.lifetime_unknown,
        row.legacy_incomplete_members,
      );
  const currentReason =
    current.tokensUsed >= limits.tokens
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
        : null;
  if (currentReason || !row.recurring)
    return {
      ...current,
      reason: currentReason,
      rootTaskId,
      usageSource: row.recurring
        ? "task_family_current_cycle"
        : "task_family_lifetime",
    };
  const daily = evidence(
    row.day_tokens,
    row.day_cost,
    row.day_rows,
    row.day_unknown,
  );
  return {
    ...daily,
    rootTaskId,
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
          : null,
  };
}
