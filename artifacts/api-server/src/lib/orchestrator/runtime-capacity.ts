import {
  agentsTable,
  approvalRequestsTable,
  companyMessagesTable,
  messagesTable,
  tasksTable,
} from "@workspace/db";
import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "./runtime-emergency-stop";

const DEFAULT_LIMITS = {
  activeAgents: 64,
  outstandingTasks: 500,
  outstandingApprovals: 200,
  messagesPerAgent: 5_000,
  companyMessages: 50_000,
} as const;

const OUTSTANDING_TASK_STATUSES = [
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
];

function boundedEnvInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function getRuntimeCapacityLimits() {
  return {
    activeAgents: boundedEnvInteger("MAX_ACTIVE_AGENTS", 64, 10_000),
    outstandingTasks: boundedEnvInteger("MAX_OUTSTANDING_TASKS", 500, 100_000),
    outstandingApprovals: boundedEnvInteger(
      "MAX_OUTSTANDING_APPROVALS",
      200,
      100_000,
    ),
    messagesPerAgent: boundedEnvInteger(
      "MAX_MESSAGES_PER_AGENT",
      5_000,
      1_000_000,
    ),
    companyMessages: boundedEnvInteger(
      "MAX_COMPANY_MESSAGES",
      50_000,
      1_000_000,
    ),
  };
}

export type RuntimeCapacityKind = keyof typeof DEFAULT_LIMITS;

export class RuntimeCapacityError extends Error {
  readonly code = "RUNTIME_CAPACITY_EXCEEDED";

  constructor(
    readonly kind: RuntimeCapacityKind,
    readonly limit: number,
  ) {
    super(`Runtime capacity exceeded for ${kind} (limit=${limit})`);
    this.name = "RuntimeCapacityError";
  }
}

async function assertBelowLimit(
  kind: RuntimeCapacityKind,
  current: number,
  increment = 1,
): Promise<void> {
  const limit = getRuntimeCapacityLimits()[kind];
  if (current + increment > limit) {
    throw new RuntimeCapacityError(kind, limit);
  }
}

export async function assertActiveAgentCapacity(
  tx: RuntimeTransaction,
  reactivatingAgentId?: number,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const [row] = await tx
    .select({ value: count() })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.isActive, true),
        reactivatingAgentId === undefined
          ? undefined
          : ne(agentsTable.id, reactivatingAgentId),
      ),
    );
  await assertBelowLimit("activeAgents", row?.value ?? 0);
}

export async function assertOutstandingTaskCapacity(
  tx: RuntimeTransaction,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const [row] = await tx
    .select({ value: count() })
    .from(tasksTable)
    .where(inArray(tasksTable.status, OUTSTANDING_TASK_STATUSES));
  await assertBelowLimit("outstandingTasks", row?.value ?? 0);
}

export async function assertOutstandingApprovalCapacity(
  tx: RuntimeTransaction,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const [row] = await tx
    .select({ value: count() })
    .from(approvalRequestsTable)
    .where(
      or(
        eq(approvalRequestsTable.status, "pending"),
        and(
          eq(approvalRequestsTable.status, "approved"),
          isNull(approvalRequestsTable.consumedAt),
          isNotNull(approvalRequestsTable.actionPayload),
        ),
      ),
    );
  await assertBelowLimit("outstandingApprovals", row?.value ?? 0);
}

export async function assertMessageCapacity(
  tx: RuntimeTransaction,
  agentId: number,
  increment = 2,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const [row] = await tx
    .select({ value: count() })
    .from(messagesTable)
    .where(eq(messagesTable.agentId, agentId));
  await assertBelowLimit("messagesPerAgent", row?.value ?? 0, increment);
}

export async function assertCompanyMessageCapacity(
  tx: RuntimeTransaction,
  increment = 1,
): Promise<void> {
  await lockRuntimeControlState(tx);
  const [row] = await tx.select({ value: count() }).from(companyMessagesTable);
  await assertBelowLimit("companyMessages", row?.value ?? 0, increment);
}
