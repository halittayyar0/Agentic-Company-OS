import { eq } from "drizzle-orm";
import { db, usageEventsTable } from "@workspace/db";
import type { CodexReportedUsage } from "./codex-task-adapter";

interface Input {
  inferenceKey: string;
  agentId: number;
  taskId: number;
  modelId: string;
  usage: CodexReportedUsage | null;
  outcome: "completed" | "failed";
  failureKind: string | null;
}
const invalid = (): never => {
  throw new Error("codex_task_usage_invalid");
};
const counter = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 2147483647;
/** Strict and idempotent; a lost insertion acknowledgement cannot append a
 * second inference. No inferred price, no masked zero usage, no best-effort
 * swallowing of the accounting error before a resumable checkpoint. */
export async function recordCodexTaskUsage(input: Input): Promise<void> {
  if (
    !/^codex:[a-f0-9]{64}$/.test(input.inferenceKey) ||
    !counter(input.agentId) ||
    input.agentId === 0 ||
    !counter(input.taskId) ||
    input.taskId === 0 ||
    !/^chatgpt:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(input.modelId) ||
    !["completed", "failed"].includes(input.outcome) ||
    (input.outcome === "completed"
      ? input.failureKind !== null
      : typeof input.failureKind !== "string" ||
        !/^codex_[a-z_]{1,50}$/.test(input.failureKind)) ||
    (input.usage !== null &&
      (!counter(input.usage.promptTokens) ||
        !counter(input.usage.completionTokens) ||
        !counter(input.usage.totalTokens)))
  )
    invalid();
  const values = {
    inferenceKey: input.inferenceKey,
    agentId: input.agentId,
    taskId: input.taskId,
    kind: "task_step",
    modelId: input.modelId,
    provider: "chatgpt",
    usageReported: input.usage !== null,
    outcome: input.outcome,
    failureKind: input.failureKind,
    promptTokens: input.usage?.promptTokens ?? 0,
    completionTokens: input.usage?.completionTokens ?? 0,
    totalTokens: input.usage?.totalTokens ?? 0,
    reportedCostUsd: null,
  };
  // Capture primitives before awaiting. An audit replay cannot mutate the
  // original usage expectation while the insertion/lookup yields.
  const [inserted] = await db
    .insert(usageEventsTable)
    .values(values)
    .onConflictDoNothing()
    .returning();
  const saved =
    inserted ??
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.inferenceKey, values.inferenceKey))
    )[0];
  if (
    !saved ||
    Object.entries(values).some(
      ([key, value]) => saved[key as keyof typeof saved] !== value,
    )
  )
    throw new Error("codex_task_usage_conflict");
}
