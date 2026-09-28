import type { OperationsStreamScope } from "./operations-event-stream";

const CANONICAL_CURSOR = /^(0|[1-9]\d*)$/;

interface CursorSnapshot {
  cursor: string;
  generatedAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function cursorSnapshot(value: unknown): CursorSnapshot | null {
  const candidate = record(value);
  return candidate &&
    typeof candidate.cursor === "string" &&
    typeof candidate.generatedAt === "string"
    ? (candidate as unknown as CursorSnapshot)
    : null;
}

export function chooseNewestOperationsSnapshot<T extends CursorSnapshot>(
  currentValue: unknown,
  incoming: T,
): T {
  const current = cursorSnapshot(currentValue);
  if (!current) return incoming;

  const currentCursorValid = CANONICAL_CURSOR.test(current.cursor);
  const incomingCursorValid = CANONICAL_CURSOR.test(incoming.cursor);
  if (currentCursorValid && !incomingCursorValid) return currentValue as T;
  if (!currentCursorValid && incomingCursorValid) return incoming;
  if (currentCursorValid && incomingCursorValid) {
    const difference = BigInt(incoming.cursor) - BigInt(current.cursor);
    if (difference < 0n) return currentValue as T;
    if (difference > 0n) return incoming;
  }

  const currentTime = timestamp(current.generatedAt);
  const incomingTime = timestamp(incoming.generatedAt);
  if (
    currentTime !== null &&
    incomingTime !== null &&
    incomingTime < currentTime
  ) {
    return currentValue as T;
  }
  return incoming;
}

export function operationsSnapshotMatchesScope(
  value: unknown,
  scope: OperationsStreamScope,
  eventCursor: string,
): boolean {
  const candidate = record(value);
  if (
    candidate === null ||
    typeof candidate.cursor !== "string" ||
    !CANONICAL_CURSOR.test(candidate.cursor) ||
    candidate.cursor !== eventCursor ||
    typeof candidate.generatedAt !== "string" ||
    timestamp(candidate.generatedAt) === null ||
    record(candidate.runtime) === null ||
    record(candidate.queue) === null ||
    record(candidate.usage) === null ||
    !Array.isArray(candidate.fleetHealthSamples)
  ) {
    return false;
  }

  if (scope.scope === "project") {
    const rootTask = record(candidate.rootTask);
    return (
      rootTask?.id === scope.taskId &&
      record(candidate.taskCounts) !== null &&
      Array.isArray(candidate.members) &&
      Array.isArray(candidate.attempts) &&
      Array.isArray(candidate.receipts) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.milestones)
    );
  }

  return (
    record(candidate.tasks) !== null && record(candidate.operations) !== null
  );
}
