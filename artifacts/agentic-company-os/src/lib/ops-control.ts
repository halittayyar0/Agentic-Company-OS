import { controlPlaneFetch } from "@/lib/auth";

export type BlockedScope =
  "agent_chat" | "task_scheduler" | "agent_tools" | "approved_actions";

export interface OpsControlState {
  emergencyStopEnabled: boolean;
  reason: string | null;
  version: number;
  updatedBy: string;
  updatedAt: string;
  blockedScopes: BlockedScope[];
}

const BLOCKED_SCOPES = new Set<BlockedScope>([
  "agent_chat",
  "task_scheduler",
  "agent_tools",
  "approved_actions",
]);

function assertOpsControlState(
  value: unknown,
): asserts value is OpsControlState {
  if (!value || typeof value !== "object") {
    throw new Error("Güvenlik freni durumu beklenen biçimde değil.");
  }
  const data = value as Partial<OpsControlState>;
  if (
    typeof data.emergencyStopEnabled !== "boolean" ||
    !(data.reason === null || typeof data.reason === "string") ||
    typeof data.version !== "number" ||
    typeof data.updatedBy !== "string" ||
    typeof data.updatedAt !== "string" ||
    !Array.isArray(data.blockedScopes) ||
    !data.blockedScopes.every((scope) => BLOCKED_SCOPES.has(scope))
  ) {
    throw new Error("Güvenlik freni durumu beklenen biçimde değil.");
  }
}

async function readOpsControl(
  input: string,
  init?: RequestInit,
): Promise<OpsControlState> {
  const state = await controlPlaneFetch<unknown>(input, init);
  assertOpsControlState(state);
  return state;
}

export function getOpsControl(): Promise<OpsControlState> {
  return readOpsControl("/api/ops/control");
}

export function updateOpsControl(input: {
  emergencyStopEnabled: boolean;
  reason?: string;
}): Promise<OpsControlState> {
  return readOpsControl("/api/ops/control", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
