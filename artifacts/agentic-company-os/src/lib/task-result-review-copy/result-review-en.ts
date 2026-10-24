import type { TaskResultReviewCopy } from "../task-result-review-copy";
export default {
  title: "Proposed result for your review",
  help: "The automatic reviewer rejected this proposal. Inspect the exact result before confirming. Confirmation finishes this task or cycle, performs no external action, and does not waive required operations.",
  loading: "Loading proposed result",
  unavailable:
    "The current proposal could not be verified. Refresh before deciding.",
  auth: "Credential authentication must be enabled and you must be signed in to review this result.",
  refresh: "Refresh review",
  acknowledge:
    "I have inspected this exact proposed result and want to confirm it.",
  confirm: "Confirm result",
  reject: "Reject result",
  confirmed: "Result confirmed by operator",
  rejected: "Result rejected; the task remains blocked.",
  error:
    "The decision outcome is unconfirmed. Refresh the review and requests before deciding again.",
  safety:
    "Confirmation is paused until safety status is available and emergency stop is off.",
  digest: "Proposal digest",
  cycle: "Cycle",
  expires: "Expires",
  requirements: "Required operations",
  satisfied: "Verified successful receipt",
  source_mismatch: "The proposed result conflicts with the read source.",
  missing_required_action:
    "The reviewer could not verify an explicitly required action.",
  unauthorized_action:
    "The reviewer flagged an action outside the authorized scope.",
  insufficient_evidence:
    "The reviewer found insufficient evidence for completion.",
  provenance: "Operator confirmed",
  provenanceHelp:
    "This result was confirmed by an operator. It was not accepted by the automatic reviewer.",
} satisfies TaskResultReviewCopy;
