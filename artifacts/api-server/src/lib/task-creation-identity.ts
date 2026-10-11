import { createHash } from "node:crypto";
import {
  parseCompletionRequirements,
  type CompletionRequirement,
} from "@workspace/db/completion-requirements";

export interface TaskCreationIdentityInput {
  title: string;
  brief: string;
  ownerAgentId?: number;
  priority?: "low" | "normal" | "high" | "urgent";
  autonomyMode?: "finite" | "continuous";
  cadenceSeconds?: number;
  dueAt?: Date | null;
  completionRequirements?: CompletionRequirement[];
}

export function taskCreationInputDigest(
  input: TaskCreationIdentityInput,
): string {
  const requirements = parseCompletionRequirements(
    input.completionRequirements,
  );
  const fields = [
    input.title.trim(),
    input.brief,
    input.ownerAgentId ?? null,
    input.priority ?? "normal",
    input.dueAt?.toISOString() ?? null,
    input.autonomyMode ?? "finite",
    input.autonomyMode === "continuous" ? (input.cadenceSeconds ?? 3600) : null,
  ];
  // Existing receipts keep their exact v1 identity. Only an explicit nonempty
  // operation contract adds a new version and canonical requirements.
  const identity = requirements.length
    ? ["task-creation-v2", ...fields, requirements]
    : ["task-creation-v1", ...fields];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
