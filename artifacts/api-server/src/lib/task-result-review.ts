import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  activityEventsTable,
  operationReceiptsTable,
  taskAttemptsTable,
  tasksTable,
  type Agent,
  type ApprovalRequest,
  type Task,
} from "@workspace/db";
import {
  TASK_RESULT_REVIEW_TOOL,
  type TaskCompletionProposal,
} from "@workspace/db/task-result-review";
import { withAgentConfigVersion } from "./agent-config-version";
import {
  completionProposalDigest,
  completionProposalMatchesContext,
  readCompletionProposal,
} from "./task-result-review-proposal";
import { checkTaskResultFormat } from "./task-result-format";
import { loadCompletionRequirementResults } from "./orchestrator/completion-requirements";
import type { RuntimeTransaction } from "./orchestrator/runtime-emergency-stop";
import { eligibleCompletionToolNames } from "./task-completion-catalog";
import { getToolsForAgent } from "./orchestrator/tools";

export class ResultReviewConflict extends Error {
  readonly code = "TASK_RESULT_REVIEW_CHANGED";
  constructor() {
    super("The proposed result or its task evidence changed");
  }
}
export function isTaskResultReview(
  approval: Pick<ApprovalRequest, "scope">,
): boolean {
  return approval.scope?.toolName === TASK_RESULT_REVIEW_TOOL;
}
export function resultReviewMetadata(approval: ApprovalRequest) {
  if (!isTaskResultReview(approval)) return {};
  const proposal = readCompletionProposal(approval.completionProposal);
  const digest = proposal ? completionProposalDigest(proposal) : null;
  return {
    resultReview: {
      kind: "task_result" as const,
      proposalHash: digest,
      cycleNumber: proposal?.cycleNumber ?? null,
      available:
        approval.status === "pending" &&
        approval.consumedAt === null &&
        approval.expiresAt !== null &&
        approval.expiresAt.getTime() > Date.now() &&
        digest !== null &&
        digest === approval.scope?.argsHash,
    },
  };
}

/** Uses the caller's lifecycle transaction; never reads a source file again. */
export async function assertCompletionProposalEvidence(
  tx: RuntimeTransaction,
  proposal: TaskCompletionProposal,
  task: Task,
  owner: Agent,
) {
  if (
    !owner.isActive ||
    !completionProposalMatchesContext(
      proposal,
      task,
      withAgentConfigVersion(owner),
    )
  )
    throw new ResultReviewConflict();
  const format = checkTaskResultFormat(
    task.resultFormat,
    proposal.resultSummary,
  );
  if (format.status !== "not_requested" && format.status !== "satisfied")
    throw new ResultReviewConflict();
  const available = new Set(
    eligibleCompletionToolNames(
      await getToolsForAgent(owner, true, { connection: tx }),
    ),
  );
  const completion = await loadCompletionRequirementResults(task, tx);
  const requirements = completion.requirements.map((item) => ({
    ...item,
    available: available.has(item.tool),
  }));
  if (requirements.some((item) => !item.satisfied || !item.available))
    throw new ResultReviewConflict();
  const [child] = await tx
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.parentTaskId, task.id),
        inArray(tasksTable.status, [
          "pending",
          "planning",
          "in_progress",
          "awaiting_approval",
          "blocked",
        ]),
      ),
    )
    .limit(1);
  if (child) throw new ResultReviewConflict();
  const [review] = await tx
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.id, proposal.judgeReviewId),
        eq(activityEventsTable.taskId, task.id),
        eq(activityEventsTable.agentId, owner.id),
        eq(activityEventsTable.type, "judge_review"),
      ),
    );
  const sourceReview = review?.detail?.sourceReview as
    Record<string, unknown> | undefined;
  if (
    review?.detail?.verdict !== "block" ||
    sourceReview?.reasonCode !== proposal.judgeReasonCode ||
    sourceReview?.scope !== "current_task_step_reads" ||
    sourceReview?.contentRetained !== false ||
    sourceReview?.documentCount !== proposal.sourceReceipts.length
  )
    throw new ResultReviewConflict();
  const [attempt] = await tx
    .select()
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.id, proposal.originAttemptId),
        eq(taskAttemptsTable.taskId, task.id),
        eq(taskAttemptsTable.agentId, owner.id),
        eq(taskAttemptsTable.cycleNumber, task.cycleCount),
      ),
    );
  if (!attempt) throw new ResultReviewConflict();
  const receipts = await tx
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        inArray(
          operationReceiptsTable.id,
          proposal.sourceReceipts.map((item) => item.receiptId),
        ),
        eq(operationReceiptsTable.taskId, task.id),
        eq(operationReceiptsTable.agentId, owner.id),
        eq(operationReceiptsTable.originAttemptId, attempt.id),
        eq(
          operationReceiptsTable.logicalExecutionId,
          attempt.logicalExecutionId,
        ),
        eq(operationReceiptsTable.executionKind, "task_step"),
        eq(operationReceiptsTable.sideEffectClass, "read_only"),
        eq(operationReceiptsTable.toolName, "vm_read_file"),
        eq(operationReceiptsTable.state, "succeeded"),
        isNull(operationReceiptsTable.reconciliationDecision),
      ),
    );
  if (
    receipts.length !== proposal.sourceReceipts.length ||
    proposal.sourceReceipts.some(
      (binding) =>
        !receipts.some(
          (receipt) =>
            receipt.id === binding.receiptId &&
            receipt.argumentHash === binding.argumentHash &&
            receipt.finishedAt !== null &&
            receipt.finishedAt >= receipt.reservedAt &&
            receipt.finishedAt <= new Date(),
        ),
    )
  )
    throw new ResultReviewConflict();
  return requirements;
}
