import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: RecordValue, expected: readonly string[]) =>
  Object.keys(value).sort().join("|") === [...expected].sort().join("|");
const textOrNull = (value: unknown) =>
  value === null || typeof value === "string";
const idOrNull = (value: unknown) =>
  value === null || (Number.isSafeInteger(value) && Number(value) > 0);
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const taskStatuses = [
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
const activityTypes = [
  "task_created",
  "task_delegated",
  "task_status_changed",
  "subagent_created",
  "progress_update",
  "judge_review",
  "approval_requested",
  "approval_resolved",
  "vm_command",
  "vm_file",
  "note",
  "error",
  "operations_changed",
] as const;
const stageEvidence = [
  "created",
  "owned",
  "planningRecorded",
  "executionRecorded",
  "reviewRecorded",
  "summaryStored",
  "markedCompleted",
  "missing",
] as const;

/** Validates the narrow public packet shape as well as its checksum. */
export function verifyEvidencePacket(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, [
      "schema",
      "exportedAt",
      "boundary",
      "task",
      "stages",
      "stats",
      "events",
      "integrity",
    ])
  )
    return false;
  const { boundary, task, stages, stats, events, integrity } = value;
  if (
    value.schema !== "agentic-company-os/evidence-window@1" ||
    typeof value.exportedAt !== "string" ||
    !object(boundary) ||
    !keys(boundary, [
      "source",
      "taskId",
      "fullHistory",
      "receipts",
      "capturedAt",
      "beforeId",
      "nextBeforeId",
      "pageNumber",
      "refreshFailed",
      "firstEventAt",
      "lastEventAt",
    ]) ||
    boundary.source !== "task-activity-api" ||
    boundary.fullHistory !== false ||
    boundary.receipts !== false ||
    !idOrNull(boundary.taskId) ||
    boundary.taskId === null ||
    !textOrNull(boundary.capturedAt) ||
    !idOrNull(boundary.beforeId) ||
    !idOrNull(boundary.nextBeforeId) ||
    !count(boundary.pageNumber) ||
    Number(boundary.pageNumber) < 1 ||
    typeof boundary.refreshFailed !== "boolean" ||
    !textOrNull(boundary.firstEventAt) ||
    !textOrNull(boundary.lastEventAt) ||
    !object(task) ||
    !keys(task, [
      "id",
      "status",
      "updatedAt",
      "stepCounter",
      "cycleCounter",
      "resultSummaryStored",
    ]) ||
    task.id !== boundary.taskId ||
    !taskStatuses.includes(task.status as (typeof taskStatuses)[number]) ||
    typeof task.updatedAt !== "string" ||
    !count(task.stepCounter) ||
    !count(task.cycleCounter) ||
    typeof task.resultSummaryStored !== "boolean" ||
    !Array.isArray(stages) ||
    stages.length !== 6 ||
    !object(stats) ||
    !keys(stats, [
      "eventCount",
      "toolEventCount",
      "judgeCount",
      "warningCount",
      "errorCount",
    ]) ||
    !Object.values(stats).every(count) ||
    !Array.isArray(events) ||
    events.length > 200 ||
    stats.eventCount !== events.length ||
    !object(integrity) ||
    !keys(integrity, ["algorithm", "digest"]) ||
    integrity.algorithm !== "SHA-256" ||
    typeof integrity.digest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(integrity.digest)
  )
    return false;
  const stageIds = ["intake", "plan", "route", "execute", "review", "deliver"];
  if (
    stages.some(
      (stage, index) =>
        !object(stage) ||
        !keys(stage, [
          "id",
          "state",
          "source",
          "evidence",
          "timestamp",
          "activityId",
        ]) ||
        stage.id !== stageIds[index] ||
        !["recorded", "missing"].includes(String(stage.state)) ||
        !["task", "activity", null].includes(stage.source as string | null) ||
        !stageEvidence.includes(
          stage.evidence as (typeof stageEvidence)[number],
        ) ||
        !textOrNull(stage.timestamp) ||
        !idOrNull(stage.activityId),
    )
  )
    return false;
  if (
    events.some(
      (event) =>
        !object(event) ||
        !keys(event, [
          "id",
          "agentId",
          "taskId",
          "type",
          "severity",
          "createdAt",
          "categories",
        ]) ||
        !idOrNull(event.id) ||
        event.id === null ||
        !idOrNull(event.agentId) ||
        event.taskId !== task.id ||
        !activityTypes.includes(event.type as (typeof activityTypes)[number]) ||
        !["info", "warning", "critical"].includes(String(event.severity)) ||
        typeof event.createdAt !== "string" ||
        !Array.isArray(event.categories) ||
        event.categories.some(
          (category: unknown) =>
            !["people", "tools", "gates", "issues"].includes(String(category)),
        ),
    )
  )
    return false;
  const { integrity: _integrity, ...body } = value;
  const digest = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  return digest === integrity.digest;
}

export async function verifyEvidenceFile(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    if ((await handle.stat()).size > 1_000_000) return false;
    const buffer = Buffer.alloc(1_000_001);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 1_000_000) return false;
    return verifyEvidencePacket(
      JSON.parse(buffer.subarray(0, length).toString("utf8")),
    );
  } finally {
    await handle.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const file = args[0];
  if (!file || args.length !== 1) {
    process.stderr.write(
      "Usage: pnpm run evidence:verify -- <evidence.json>\n",
    );
    process.exitCode = 2;
  } else {
    verifyEvidenceFile(file).then(
      (valid) => {
        process.stdout.write(
          valid
            ? "Evidence packet checksum and shape: valid\n"
            : "Evidence packet: invalid\n",
        );
        if (!valid) process.exitCode = 1;
      },
      () => {
        process.stderr.write("Evidence packet could not be read or parsed.\n");
        process.exitCode = 1;
      },
    );
  }
}
