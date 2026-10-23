import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { Task } from "@workspace/db";
import type { TaskCompletionProposal } from "@workspace/db/task-result-review";
import { parseTaskResultFormat } from "@workspace/db/task-result-format";
import { parseCompletionRequirements } from "@workspace/db/completion-requirements";
import { canonicalArgumentHash } from "./orchestrator/operation-receipts";

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const identifier = z.number().int().positive().max(2147483647);
const cycle = z.number().int().min(0).max(2147483647);
const summary = z
  .string()
  .min(1)
  .max(65536)
  .refine(
    (value) =>
      value.trim() === value &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
      Buffer.from(value, "utf8").toString("utf8") === value,
  );
const canonicalInstant = z.string().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
});
const proposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: identifier,
    ownerAgentId: identifier,
    ownerConfigVersion: digest,
    cycleNumber: cycle,
    cycleStartedAt: canonicalInstant,
    originAttemptId: z.uuid(),
    judgeReviewId: identifier,
    judgeReasonCode: z.enum([
      "source_mismatch",
      "missing_required_action",
      "unauthorized_action",
      "insufficient_evidence",
    ]),
    contextHash: digest,
    resultSummary: summary,
    resultSummaryHash: digest,
    sourceReceipts: z
      .array(
        z
          .object({
            receiptId: z
              .string()
              .min(1)
              .max(120)
              .refine(
                (value) =>
                  value.trim() === value &&
                  !/[\u0000-\u001f\u007f]/u.test(value),
              ),
            argumentHash: digest,
            fileSha256: digest,
            byteCount: z.number().int().min(0).max(4096),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

export function readCompletionProposal(
  value: unknown,
): TaskCompletionProposal | null {
  const parsed = proposalSchema.safeParse(value);
  if (!parsed.success) return null;
  const proposal = parsed.data;
  if (
    createHash("sha256")
      .update(proposal.resultSummary, "utf8")
      .digest("hex") !== proposal.resultSummaryHash ||
    new Set(proposal.sourceReceipts.map((row) => row.receiptId)).size !==
      proposal.sourceReceipts.length ||
    Buffer.byteLength(JSON.stringify(proposal), "utf8") > 300000
  )
    return null;
  return proposal;
}

export type CompletionReviewContextTask = Pick<
  Task,
  | "id"
  | "title"
  | "brief"
  | "ownerAgentId"
  | "cycleCount"
  | "createdAt"
  | "lastCycleCompletedAt"
  | "autonomyMode"
  | "cadenceSeconds"
  | "executionModelId"
  | "completionRequirements"
  | "resultFormat"
>;
export interface CompletionReviewContextAgent {
  id: number;
  configVersion: string;
}

/** Editable owner settings participate; heartbeats/leases never alter this hash. */
export function completionProposalContextHash(
  task: CompletionReviewContextTask,
  agent: CompletionReviewContextAgent,
): string {
  return canonicalArgumentHash({
    schemaVersion: 1,
    taskId: task.id,
    title: task.title,
    brief: task.brief,
    ownerAgentId: task.ownerAgentId,
    ownerConfigVersion: agent.configVersion,
    cycleNumber: task.cycleCount,
    cycleStartedAt: (task.lastCycleCompletedAt ?? task.createdAt).toISOString(),
    autonomyMode: task.autonomyMode,
    cadenceSeconds: task.cadenceSeconds,
    executionModelId: task.executionModelId,
    resultFormat: parseTaskResultFormat(task.resultFormat),
    completionRequirements: parseCompletionRequirements(
      task.completionRequirements,
    ),
  });
}

export function completionProposalDigest(
  proposal: TaskCompletionProposal,
): string {
  return canonicalArgumentHash(proposal);
}

export function completionProposalMatchesContext(
  proposal: TaskCompletionProposal,
  task: CompletionReviewContextTask,
  agent: CompletionReviewContextAgent,
): boolean {
  try {
    return (
      proposal.taskId === task.id &&
      proposal.ownerAgentId === task.ownerAgentId &&
      proposal.ownerAgentId === agent.id &&
      proposal.ownerConfigVersion === agent.configVersion &&
      proposal.cycleNumber === task.cycleCount &&
      proposal.cycleStartedAt ===
        (task.lastCycleCompletedAt ?? task.createdAt).toISOString() &&
      proposal.contextHash === completionProposalContextHash(task, agent)
    );
  } catch {
    return false;
  }
}
