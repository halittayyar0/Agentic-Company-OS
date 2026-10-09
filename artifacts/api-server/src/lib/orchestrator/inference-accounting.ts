import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  agentsTable,
  db,
  inferenceAttemptsTable as attempts,
  tasksTable,
  usageEventsTable,
  type InferenceAttempt,
} from "@workspace/db";
import {
  createChatCompletion,
  PlanInferenceError,
  resolveLlmRequestTimeoutMs,
} from "@workspace/ai-server";
import type OpenAI from "openai";
import {
  normalizeCompletionUsage,
  type RecordedUsage,
  type UsageContext,
  type UsageKind,
} from "./usage-ledger";
import { ModelAdmissionDeniedError } from "./model-fallback";
import {
  lockAndAssertExecutionAllowed,
  EmergencyStopError,
} from "./runtime-emergency-stop";
import {
  executionSpendLimits,
  readTaskSpendBlockReason,
  TaskSpendBudgetError,
} from "./task-spend-admission";
import { logger } from "../logger";

import { InferenceAccountingError } from "./inference-accounting-errors";
import { recordInferenceResponseEvidence } from "./inference-response-evidence";
import { poisonInferenceEvidence } from "./inference-evidence-poison";
import {
  applyInferenceUsageCorrection,
  reconcileInferenceResponseEvidence,
} from "./inference-usage-correction";
export { InferenceAccountingError } from "./inference-accounting-errors";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Queue/dispatch callers hold runtime control before this marker, then take
 * agent/task row locks. Settlement only needs marker -> receipt. A superseded
 * admission read cannot permanently pause work. */
export async function lockInferenceAccountingStatus(
  tx: Transaction,
  id: string,
  now = new Date(),
): Promise<"pending" | "recovery_required" | null> {
  await tx.execute(
    sql`SELECT id FROM inference_attempts WHERE id=${id}::uuid FOR UPDATE`,
  );
  const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, id));
  if (!attempt) return "recovery_required";
  if (attempt.evidenceConflictAt) return "recovery_required";
  if (attempt.state === "accounted" || attempt.state === "not_dispatched")
    return null;
  return attempt.state !== "uncertain" &&
    attempt.requestDeadlineAt.getTime() > now.getTime()
    ? "pending"
    : "recovery_required";
}
export interface AccountedInferenceContext extends UsageContext {
  locale?: "tr" | "en" | "de" | "ru" | "zh-CN" | "zh-TW" | "ar";
  agentLeaseOwner?: string;
  taskLeaseOwner?: string;
  assertOwnership?: () => Promise<void>;
}

async function scope(context: UsageContext, tx: Transaction): Promise<string> {
  if (context.taskId === null) return `agent:${context.agentId}`;
  const result = await tx.execute(sql`WITH RECURSIVE ancestors AS (
    SELECT id,parent_task_id FROM tasks WHERE id=${context.taskId}
    UNION SELECT t.id,t.parent_task_id FROM tasks t JOIN ancestors a ON t.id=a.parent_task_id
  ) SELECT id FROM ancestors WHERE parent_task_id IS NULL`);
  if (result.rows.length !== 1 || !Number.isSafeInteger(result.rows[0].id))
    throw new InferenceAccountingError("conflict");
  return `task:${result.rows[0].id}`;
}

async function admit(
  context: AccountedInferenceContext,
  tx: Transaction,
  excludeId?: string,
): Promise<string> {
  await lockAndAssertExecutionAllowed(tx);
  await tx.execute(
    sql`SELECT id FROM agents WHERE id=${context.agentId} FOR UPDATE`,
  );
  const [agent] = await tx
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, context.agentId));
  if (
    !agent?.isActive ||
    (context.agentLeaseOwner !== undefined &&
      (agent.runLeaseOwner !== context.agentLeaseOwner ||
        !agent.runLeaseExpiresAt ||
        agent.runLeaseExpiresAt.getTime() <= Date.now()))
  )
    throw new InferenceAccountingError("conflict");
  const scopeKey = await scope(context, tx);
  const [unsettled] = await tx
    .select()
    .from(attempts)
    .where(
      and(
        or(
          eq(attempts.scopeKey, scopeKey),
          eq(attempts.agentId, context.agentId),
        ),
        sql`(${attempts.state} IN ('reserved','dispatched','uncertain') OR ${attempts.evidenceConflictAt} IS NOT NULL)`,
        excludeId ? sql`${attempts.id} <> ${excludeId}::uuid` : undefined,
      ),
    );
  if (unsettled)
    throw new InferenceAccountingError(
      "unsettled",
      unsettled.id,
      !unsettled.evidenceConflictAt &&
        unsettled.state !== "uncertain" &&
        unsettled.requestDeadlineAt.getTime() > Date.now()
        ? "pending"
        : "recovery_required",
    );
  if (context.taskId !== null) {
    await tx.execute(
      sql`SELECT id FROM tasks WHERE id=${context.taskId} FOR UPDATE`,
    );
    const [task] = await tx
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, context.taskId));
    if (
      !task ||
      (context.taskLeaseOwner !== undefined &&
        (task.leaseOwner !== context.taskLeaseOwner ||
          !task.leaseExpiresAt ||
          task.leaseExpiresAt.getTime() <= Date.now()))
    )
      throw new InferenceAccountingError("conflict");
    const reason = await readTaskSpendBlockReason(
      task,
      { ...executionSpendLimits(), maxSteps: null },
      context.locale ?? "en",
      new Date(),
      tx,
      excludeId,
    );
    if (reason) throw new TaskSpendBudgetError(reason);
  }
  return scopeKey;
}

async function reserve(
  context: AccountedInferenceContext,
): Promise<InferenceAttempt> {
  // A lost acknowledgement is never followed by a provider call. The durable
  // reservation, if committed, remains a fence even in a fresh process.
  try {
    return await db.transaction(async (tx) => {
      const scopeKey = await admit(context, tx);
      const [attempt] = await tx
        .insert(attempts)
        .values({
          id: randomUUID(),
          agentId: context.agentId,
          taskId: context.taskId,
          scopeKey,
          modelId: context.modelId,
          provider: context.provider,
          kind: context.kind,
          invocationOwnerId: randomUUID(),
          requestDeadlineAt: new Date(
            Date.now() + resolveLlmRequestTimeoutMs() + 60_000,
          ),
        })
        .returning();
      return attempt;
    });
  } catch (error) {
    if (
      error instanceof ModelAdmissionDeniedError ||
      error instanceof EmergencyStopError
    )
      throw error;
    throw new InferenceAccountingError("storage");
  }
}

async function dispatch(
  attempt: InferenceAttempt,
  context: AccountedInferenceContext,
  beforeTransition: () => void,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await lockAndAssertExecutionAllowed(tx);
      await tx.execute(
        sql`SELECT id FROM inference_attempts WHERE id=${attempt.id}::uuid FOR UPDATE`,
      );
      if ((await admit(context, tx, attempt.id)) !== attempt.scopeKey)
        throw new InferenceAccountingError("conflict", attempt.id);
      // Admission/ownership can change during local provider preparation.
      // The reservation is definitely unstarted until this mutation is issued;
      // from this point, a failed acknowledgement must retain its fence.
      beforeTransition();
      const [updated] = await tx
        .update(attempts)
        .set({ state: "dispatched", dispatchedAt: new Date() })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.state, "reserved")))
        .returning();
      if (!updated) throw new InferenceAccountingError("conflict", attempt.id);
    });
  } catch (error) {
    if (
      error instanceof ModelAdmissionDeniedError ||
      error instanceof EmergencyStopError
    )
      throw error;
    throw new InferenceAccountingError("storage", attempt.id);
  }
}

async function settle(
  attempt: InferenceAttempt,
  provider: string,
  usage: OpenAI.Completions.CompletionUsage | undefined,
  outcome: "completed" | "failed",
  failureKind: string | null,
): Promise<RecordedUsage> {
  if (provider !== attempt.provider)
    throw new InferenceAccountingError("conflict", attempt.id);
  const normalized = normalizeCompletionUsage(
    { ...attempt, provider, kind: attempt.kind as UsageKind },
    usage,
  );
  if (
    ![
      normalized.promptTokens,
      normalized.completionTokens,
      normalized.totalTokens,
    ].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) ||
    (normalized.reportedCostUsd !== null &&
      (normalized.reportedCostUsd >= 1_000_000 ||
        Number(normalized.reportedCostUsd.toFixed(6)) >= 1_000_000 ||
        (normalized.reportedCostUsd > 0 &&
          Number(normalized.reportedCostUsd.toFixed(6)) === 0)))
  )
    throw new InferenceAccountingError("conflict", attempt.id);
  const values = {
    ordinaryInferenceId: attempt.id,
    agentId: attempt.agentId,
    taskId: attempt.taskId,
    kind: attempt.kind,
    modelId: attempt.modelId,
    provider,
    outcome,
    failureKind,
    promptTokens: normalized.promptTokens,
    completionTokens: normalized.completionTokens,
    totalTokens: normalized.totalTokens,
    usageReported: normalized.usageReported,
    reportedCostUsd:
      normalized.reportedCostUsd === null
        ? null
        : normalized.reportedCostUsd.toFixed(6),
  };
  // Retry persistence only. Exactly matching existing evidence repairs a lost
  // commit acknowledgement; conflict cannot become another billable request.
  for (let retry = 0; retry < 3; retry++) {
    try {
      const consistent = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM inference_attempts WHERE id=${attempt.id}::uuid FOR UPDATE`,
        );
        const [live] = await tx
          .select()
          .from(attempts)
          .where(eq(attempts.id, attempt.id));
        if (
          !live ||
          live.evidenceConflictAt !== null ||
          !["dispatched", "accounted", "uncertain"].includes(live.state)
        )
          throw new InferenceAccountingError("conflict", attempt.id);
        const [inserted] = await tx
          .insert(usageEventsTable)
          .values(values)
          .onConflictDoNothing()
          .returning();
        const saved =
          inserted ??
          (
            await tx
              .select()
              .from(usageEventsTable)
              .where(eq(usageEventsTable.ordinaryInferenceId, attempt.id))
          )[0];
        if (
          !saved ||
          Object.entries(values).some(
            ([key, value]) => saved[key as keyof typeof saved] !== value,
          )
        ) {
          // Commit the fence before reporting the conflict. Throwing inside
          // this transaction would roll back uncertainty after a prior commit.
          await poisonInferenceEvidence(tx, live);
          return false;
        }
        const correction = await applyInferenceUsageCorrection(tx, attempt.id);
        if (correction === "conflict") return false;
        await tx
          .update(attempts)
          .set({
            state:
              correction === "applied" || normalized.usageReported
                ? "accounted"
                : "uncertain",
            settledAt: new Date(),
          })
          .where(eq(attempts.id, attempt.id));
        return true;
      });
      if (!consistent)
        throw new InferenceAccountingError("conflict", attempt.id);
      return normalized;
    } catch (error) {
      if (error instanceof InferenceAccountingError) throw error;
      if (retry === 2)
        throw new InferenceAccountingError("storage", attempt.id);
    }
  }
  throw new InferenceAccountingError("storage", attempt.id);
}

export async function runAccountedCompletion(
  suppliedContext: AccountedInferenceContext,
  suppliedParams: Parameters<typeof createChatCompletion>[0],
  complete: typeof createChatCompletion = createChatCompletion,
): Promise<
  Awaited<ReturnType<typeof createChatCompletion>> & { usage: RecordedUsage }
> {
  // Bind the requested route before any async ownership/admission work. A
  // caller's mutable input cannot change the route attached to late evidence.
  const context = { ...suppliedContext },
    params = { ...suppliedParams };
  if (context.modelId !== params.model)
    throw new InferenceAccountingError("conflict");
  await context.assertOwnership?.();
  const attempt = await reserve(context);
  let dispatched = false,
    boundaryFailure: unknown,
    observationFailure: unknown,
    dispatchInvoked = false,
    transitionAttempted = false;
  let result: Awaited<ReturnType<typeof createChatCompletion>>;
  try {
    result = await complete({
      ...params,
      disableRetries: true,
      onResponseUsage: async (evidence) => {
        try {
          if (!dispatched || !attempt.invocationOwnerId)
            throw new InferenceAccountingError("conflict", attempt.id);
          await recordInferenceResponseEvidence(
            attempt.id,
            attempt.invocationOwnerId,
            evidence,
          );
          await reconcileInferenceResponseEvidence(attempt.id);
        } catch (error) {
          observationFailure = error;
          throw error;
        }
      },
      beforeRequest: async () => {
        // A custom runner or SDK retry cannot invoke a second dispatch boundary.
        if (dispatchInvoked)
          throw new InferenceAccountingError("conflict", attempt.id);
        dispatchInvoked = true;
        try {
          await context.assertOwnership?.();
          await dispatch(attempt, context, () => {
            transitionAttempted = true;
          });
          dispatched = true;
        } catch (error) {
          boundaryFailure = error;
          throw error;
        }
      },
    });
    if (!dispatched) throw new InferenceAccountingError("conflict", attempt.id);
  } catch (error) {
    // If the dispatch mutation was issued but not acknowledged, its state may have
    // committed. Never release it as definitely unbilled or infer a zero row.
    if (!transitionAttempted) {
      try {
        await db
          .update(attempts)
          .set({ state: "not_dispatched", settledAt: new Date() })
          .where(
            and(
              eq(attempts.id, attempt.id),
              attempt.invocationOwnerId
                ? eq(attempts.invocationOwnerId, attempt.invocationOwnerId)
                : isNull(attempts.invocationOwnerId),
              eq(attempts.state, "reserved"),
              isNull(attempts.dispatchedAt),
              isNull(attempts.evidenceConflictAt),
            ),
          );
      } catch {
        if (boundaryFailure !== undefined) {
          logger.error(
            { attemptId: attempt.id, code: "INFERENCE_ACCOUNTING_REQUIRED" },
            "Unstarted ownership failure retains a reservation after failed release",
          );
          throw boundaryFailure;
        }
        throw new InferenceAccountingError("storage", attempt.id);
      }
      throw boundaryFailure ?? error;
    }
    if (boundaryFailure !== undefined) throw boundaryFailure;
    if (observationFailure !== undefined) {
      await context.assertOwnership?.();
      throw observationFailure;
    }
    try {
      const failureUsage = await settle(
        attempt,
        context.provider,
        error instanceof PlanInferenceError
          ? (error.usage ?? undefined)
          : undefined,
        "failed",
        error instanceof PlanInferenceError ? error.kind : "provider_failure",
      );
      if (!failureUsage.usageReported)
        throw new InferenceAccountingError("unknown", attempt.id);
    } catch (accountingError) {
      logger.error(
        { attemptId: attempt.id, code: "INFERENCE_ACCOUNTING_REQUIRED" },
        "Inference failure retains unsettled accounting",
      );
      if (error instanceof EmergencyStopError) throw error;
      throw accountingError;
    }
    throw error;
  }
  let ownershipFailure: unknown;
  try {
    await context.assertOwnership?.();
  } catch (error) {
    ownershipFailure = error;
  }
  let usage: RecordedUsage;
  try {
    usage = await settle(
      attempt,
      result.provider,
      result.completion.usage,
      "completed",
      null,
    );
  } catch (error) {
    if (ownershipFailure !== undefined) throw ownershipFailure;
    throw error;
  }
  if (ownershipFailure !== undefined) throw ownershipFailure;
  await context.assertOwnership?.();
  if (!usage.usageReported)
    throw new InferenceAccountingError("unknown", attempt.id);
  return { ...result, usage };
}
