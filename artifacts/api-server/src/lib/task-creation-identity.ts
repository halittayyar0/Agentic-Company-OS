import { createHash } from "node:crypto";
import {
  parseCompletionRequirements,
  type CompletionRequirement,
} from "@workspace/db/completion-requirements";
import {
  parseTaskResultFormat,
  type TaskResultFormat,
} from "@workspace/db/task-result-format";

export interface TaskCreationIdentityInput {
  title: string;
  brief: string;
  ownerAgentId?: number;
  priority?: "low" | "normal" | "high" | "urgent";
  autonomyMode?: "finite" | "continuous";
  cadenceSeconds?: number;
  dueAt?: Date | null;
  completionRequirements?: CompletionRequirement[];
  resultFormat?: TaskResultFormat | null;
}

export function taskCreationInputDigest(
  input: TaskCreationIdentityInput,
): string {
  const requirements = parseCompletionRequirements(
    input.completionRequirements,
  );
  const resultFormat = parseTaskResultFormat(input.resultFormat);
  const fields = [
    input.title.trim(),
    input.brief,
    input.ownerAgentId ?? null,
    input.priority ?? "normal",
    input.dueAt?.toISOString() ?? null,
    input.autonomyMode ?? "finite",
    input.autonomyMode === "continuous" ? (input.cadenceSeconds ?? 3600) : null,
  ];
  // Omitted/null layouts preserve exact v1/v2 receipts. Only an explicit
  // layout adds v3; column order remains part of the owner's request identity.
  const identity = resultFormat
    ? ["task-creation-v3", ...fields, requirements, resultFormat]
    : requirements.length
      ? ["task-creation-v2", ...fields, requirements]
      : ["task-creation-v1", ...fields];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
