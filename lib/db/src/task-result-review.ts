/** Server-created pending result; not an executable action or agent permission. */
export interface TaskCompletionProposal {
  schemaVersion: 1;
  taskId: number;
  ownerAgentId: number;
  ownerConfigVersion: string;
  cycleNumber: number;
  cycleStartedAt: string;
  originAttemptId: string;
  judgeReviewId: number;
  judgeReasonCode:
    | "source_mismatch"
    | "missing_required_action"
    | "unauthorized_action"
    | "insufficient_evidence";
  contextHash: string;
  resultSummary: string;
  resultSummaryHash: string;
  sourceReceipts: Array<{
    receiptId: string;
    argumentHash: string;
    fileSha256: string;
    byteCount: number;
  }>;
}

export type TaskCompletionAuthority = "agent" | "operator";

export const TASK_RESULT_REVIEW_TOOL = "operator_confirm_task_result";
