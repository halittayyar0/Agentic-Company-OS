import type { ApprovalScope } from "@workspace/db";

export type ApprovalCapabilityTombstoneReason =
  "REJECTED" | "CANCELLED" | "AGENT_DEACTIVATED" | "EXPIRED";

const LEGACY_TOOL_NAME = "legacy_redacted";
const LEGACY_ARGS_HASH = "legacy-redacted";

/**
 * Removes executable or user-entered capability material while retaining only
 * bounded audit identity. The defensive fallback also handles malformed JSON
 * written before approval-scope validation existed.
 */
export function redactApprovalCapabilityScope(
  scope: ApprovalScope | null | unknown,
  reason: ApprovalCapabilityTombstoneReason,
): ApprovalScope | null {
  if (scope === null || scope === undefined) return null;
  if (typeof scope !== "object" || Array.isArray(scope)) {
    return {
      toolName: LEGACY_TOOL_NAME,
      argsHash: LEGACY_ARGS_HASH,
      target: null,
      preview: `${reason}: legacy capability redacted`,
    };
  }

  const record = scope as Record<string, unknown>;
  const toolName =
    typeof record.toolName === "string" && record.toolName.trim()
      ? record.toolName
      : LEGACY_TOOL_NAME;
  const argsHash =
    typeof record.argsHash === "string" && record.argsHash.trim()
      ? record.argsHash
      : LEGACY_ARGS_HASH;
  const browserScoped =
    toolName === "browser_click" || toolName === "browser_type";
  const target =
    !browserScoped && typeof record.target === "string" ? record.target : null;

  return {
    toolName,
    argsHash,
    target,
    preview: `${reason}: capability sha256:${argsHash}`,
  };
}
