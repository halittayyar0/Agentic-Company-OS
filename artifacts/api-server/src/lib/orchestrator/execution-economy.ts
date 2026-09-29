import type { ComplexityHint } from "@workspace/ai-server";

/** Organization rank is not evidence that a model turn needs a stronger tier. */
export function executionComplexity(task: {
  autonomyMode?: string;
  stepAttempts: number;
  consecutiveFailures: number;
  progressPercent: number;
}): ComplexityHint {
  return task.consecutiveFailures >= 2 ||
    (task.autonomyMode !== "continuous" &&
      task.stepAttempts >= 4 &&
      task.progressPercent < 80)
    ? "high"
    : "normal";
}
