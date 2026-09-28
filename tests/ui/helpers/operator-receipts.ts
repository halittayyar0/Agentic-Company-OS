import type {
  OperatorRequestReceipt,
  VmExecResult,
} from "../../../../lib/api-client-react/src";

export function operatorReceipt(
  requestId: string,
  kind: OperatorRequestReceipt["kind"],
  result: VmExecResult | null = null,
): OperatorRequestReceipt {
  return {
    requestId,
    agentId: 2,
    kind,
    state: "complete",
    createdAt: "2026-09-27T10:00:00.000Z",
    expiresAt: "2026-09-27T10:03:00.000Z",
    dispatchedAt: "2026-09-27T10:00:01.000Z",
    completedAt: "2026-09-27T10:00:02.000Z",
    failureCode: null,
    terminal: result
      ? {
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        }
      : null,
    resultAvailability: result ? "available" : "not_applicable",
    result,
  };
}
