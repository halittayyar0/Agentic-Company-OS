import {
  customFetch,
  type InferenceAccountingSnapshot,
} from "@workspace/api-client-react";
const integer = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown) =>
  integer(value) && Number(value) <= 8_640_000_000_000_000;
/** Reject a response for another scope before it can replace the last good view. */
export async function getInferenceAccountingSnapshot(
  scopeType: "task" | "agent",
  scopeId: number,
  signal?: AbortSignal,
): Promise<InferenceAccountingSnapshot> {
  const value = await customFetch<InferenceAccountingSnapshot>(
    `/api/inference-accounting?scopeType=${scopeType}&scopeId=${scopeId}`,
    { method: "GET", cache: "no-store", signal },
  );
  if (
    !value ||
    value.scopeType !== scopeType ||
    value.scopeId !== scopeId ||
    !["clear", "pending", "recovery_required"].includes(value.status) ||
    !timestamp(value.observedAt) ||
    !integer(value.unsettledCount) ||
    typeof value.hasMore !== "boolean" ||
    (value.status === "clear") !== (value.unsettledCount === 0) ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > 20 ||
    value.attempts.some((a) => {
      const usage = a?.usage;
      return (
        !a ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          a.id,
        ) ||
        !integer(a.agentId) ||
        a.agentId < 1 ||
        (scopeType === "agent" && a.agentId !== scopeId) ||
        typeof a.modelId !== "string" ||
        typeof a.provider !== "string" ||
        (a.savedEvidenceAvailable !== undefined &&
          typeof a.savedEvidenceAvailable !== "boolean") ||
        ![
          "reserved",
          "dispatched",
          "uncertain",
          "accounted",
          "not_dispatched",
        ].includes(a.state) ||
        !timestamp(a.createdAt) ||
        !timestamp(a.requestDeadlineAt) ||
        (a.dispatchedAt !== null && !timestamp(a.dispatchedAt)) ||
        (a.settledAt !== null && !timestamp(a.settledAt)) ||
        (usage !== null &&
          (!usage ||
            ![
              usage.promptTokens,
              usage.completionTokens,
              usage.totalTokens,
            ].every(integer) ||
            typeof usage.usageReported !== "boolean" ||
            (usage.usageReported &&
              usage.totalTokens <
                usage.promptTokens + usage.completionTokens) ||
            (usage.reportedCostUsd !== null &&
              (typeof usage.reportedCostUsd !== "string" ||
                !/^\d+(\.\d+)?$/.test(usage.reportedCostUsd)))))
      );
    })
  )
    throw new Error("Invalid status");
  return value;
}

export async function applySavedInferenceUsage(
  scopeType: "task" | "agent",
  scopeId: number,
  attemptId: string,
) {
  const value = await customFetch<{
    scopeType: "task" | "agent";
    scopeId: number;
    attemptId: string;
    outcome: "applied" | "pending";
  }>(
    `/api/inference-accounting/${attemptId}/reconcile?scopeType=${scopeType}&scopeId=${scopeId}`,
    {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ acknowledge: true }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (
    value.scopeType !== scopeType ||
    value.scopeId !== scopeId ||
    value.attemptId !== attemptId ||
    !["applied", "pending"].includes(value.outcome)
  )
    throw new Error("Invalid outcome");
  return value.outcome;
}
