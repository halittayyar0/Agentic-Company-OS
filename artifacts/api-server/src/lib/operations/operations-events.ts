import {
  activityEventsTable,
  db,
  type ActivityEventSeverity,
  type OperationInvocationState,
  type OperationReceiptState,
  type RuntimeInstanceState,
  type TaskAttemptState,
} from "@workspace/db";
import { z } from "zod";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OperationsEventExecutor = typeof db | DatabaseTransaction;

export const operationsEventKinds = [
  "runtime_registered",
  "runtime_state_changed",
  "attempt_created",
  "attempt_state_changed",
  "receipt_reserved",
  "receipt_state_changed",
  "invocation_created",
  "invocation_state_changed",
  "recovery_recorded",
  "runtime_control_changed",
  "reconciliation_recorded",
  "health_sample_recorded",
] as const;
export type OperationsEventKind = (typeof operationsEventKinds)[number];

export type OperationsEventState =
  | RuntimeInstanceState
  | TaskAttemptState
  | OperationReceiptState
  | OperationInvocationState;

const operationsEventStates = [
  "starting",
  "healthy",
  "draining",
  "stale",
  "stopped",
  "claimed",
  "running",
  "succeeded",
  "retrying",
  "blocked",
  "lost",
  "reserved",
  "failed",
  "unknown",
] as const;

const OperationsEventDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.enum(operationsEventKinds),
    runtimeInstanceId: z.string().min(1).max(256).optional(),
    attemptId: z.string().min(1).max(256).optional(),
    receiptId: z.string().min(1).max(256).optional(),
    invocationId: z.string().min(1).max(256).optional(),
    state: z.enum(operationsEventStates).optional(),
    enabled: z.boolean().optional(),
    bucketAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type OperationsEventDetail = z.infer<typeof OperationsEventDetailSchema>;

export interface AppendOperationsChangedInput {
  kind: OperationsEventKind;
  taskId?: number | null;
  agentId?: number | null;
  runtimeInstanceId?: string | null;
  attemptId?: string | null;
  receiptId?: string | null;
  invocationId?: string | null;
  state?: OperationsEventState | null;
  enabled?: boolean | null;
  bucketAt?: Date | null;
  createdAt?: Date;
}

const summaries: Readonly<Record<OperationsEventKind, string>> = {
  runtime_registered: "Operational runtime registered.",
  runtime_state_changed: "Operational runtime state changed.",
  attempt_created: "Operational attempt created.",
  attempt_state_changed: "Operational attempt state changed.",
  receipt_reserved: "Operational receipt reserved.",
  receipt_state_changed: "Operational receipt state changed.",
  invocation_created: "Operational invocation created.",
  invocation_state_changed: "Operational invocation state changed.",
  recovery_recorded: "Operational recovery recorded.",
  runtime_control_changed: "Operational runtime control changed.",
  reconciliation_recorded: "Operational reconciliation recorded.",
  health_sample_recorded: "Operational health sample recorded.",
};

function severityFor(
  input: AppendOperationsChangedInput,
): ActivityEventSeverity {
  if (input.kind === "runtime_control_changed") {
    return input.enabled === true ? "critical" : "info";
  }
  if (input.state === "unknown") return "critical";
  if (
    input.kind === "recovery_recorded" ||
    input.state === "failed" ||
    input.state === "lost" ||
    input.state === "stale"
  ) {
    return "warning";
  }
  return "info";
}

function detailFor(input: AppendOperationsChangedInput): OperationsEventDetail {
  return OperationsEventDetailSchema.parse({
    schemaVersion: 1,
    kind: input.kind,
    ...(input.runtimeInstanceId
      ? { runtimeInstanceId: input.runtimeInstanceId }
      : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.receiptId ? { receiptId: input.receiptId } : {}),
    ...(input.invocationId ? { invocationId: input.invocationId } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.enabled === null || input.enabled === undefined
      ? {}
      : { enabled: input.enabled }),
    ...(input.bucketAt ? { bucketAt: input.bucketAt.toISOString() } : {}),
  });
}

export function parseOperationsEventDetail(
  value: unknown,
): OperationsEventDetail | null {
  const parsed = OperationsEventDetailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function appendOperationsChanged(
  executor: OperationsEventExecutor,
  input: AppendOperationsChangedInput,
): Promise<{ id: number }> {
  const [event] = await executor
    .insert(activityEventsTable)
    .values({
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      type: "operations_changed",
      summary: summaries[input.kind],
      detail: detailFor(input),
      severity: severityFor(input),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: activityEventsTable.id });
  if (!event) throw new Error("Operations event insert returned no row");
  return event;
}
