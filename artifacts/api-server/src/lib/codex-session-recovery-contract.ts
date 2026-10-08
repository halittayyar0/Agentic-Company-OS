import {
  GetCodexSessionRecoveryResponse,
  RecoverCodexSessionBody,
  RecoverCodexSessionResponse,
} from "@workspace/api-zod";
export const CodexRecoveryInput = RecoverCodexSessionBody.strict();
export const CodexRecoveryStatus = GetCodexSessionRecoveryResponse.strict();
export const CodexRecoveryReceipt =
  RecoverCodexSessionResponse.strict().superRefine((r, ctx) => {
    if (
      (r.outcome === "accepted" &&
        (r.reason !== null || r.revision !== r.expectedRevision + 1)) ||
      (r.outcome === "rejected" && r.reason === null)
    )
      ctx.addIssue({ code: "custom", message: "Invalid recovery receipt" });
  });
