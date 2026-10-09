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
    value.attempts.some(
      (a) =>
        !a ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          a.id,
        ) ||
        !integer(a.agentId) ||
        a.agentId < 1 ||
        (scopeType === "agent" && a.agentId !== scopeId) ||
        typeof a.modelId !== "string" ||
        typeof a.provider !== "string" ||
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
        (a.usage !== null &&
          (!a.usage ||
            ![
              a.usage.promptTokens,
              a.usage.completionTokens,
              a.usage.totalTokens,
            ].every(integer) ||
            typeof a.usage.usageReported !== "boolean" ||
            (a.usage.usageReported &&
              a.usage.totalTokens <
                a.usage.promptTokens + a.usage.completionTokens) ||
            (a.usage.reportedCostUsd !== null &&
              (typeof a.usage.reportedCostUsd !== "string" ||
                !/^\d+(\.\d+)?$/.test(a.usage.reportedCostUsd))))),
    )
  )
    throw new Error("Accounting status cannot be verified");
  return value;
}
