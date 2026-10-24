import { safeInteger, stringChoices } from "./schema-primitives";
import * as z from "zod/v4-mini";
import type {
  ApprovalRequest,
  TaskResultReview,
} from "@workspace/api-client-react";
import { resultFormatInputSchema } from "./task-result-format-input";
import { parseResultTable } from "./task-result-table";
const positive = safeInteger.check(z.minimum(1));
const cycle = safeInteger.check(z.minimum(0));
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u));
const schema = z.strictObject({
  approvalId: positive,
  taskId: positive,
  cycleNumber: cycle,
  proposalHash: digest,
  resultSummary: z.string().check(z.minLength(1), z.maxLength(65536)),
  resultFormat: resultFormatInputSchema,
  judgeReasonCode: stringChoices([
    "source_mismatch",
    "missing_required_action",
    "unauthorized_action",
    "insufficient_evidence",
  ]),
  expiresAt: z.string().check(z.iso.datetime({ offset: true })),
  requirements: z
    .array(
      z.strictObject({
        kind: z.literal("tool_succeeded"),
        tool: z.string().check(z.regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u)),
        satisfied: z.boolean(),
        available: z.boolean(),
      }),
    )
    .check(z.maxLength(8)),
});

/** A downloaded proposal grants no authority until the server accepts its exact digest. */
export function readTaskResultReview(
  value: unknown,
  approval: ApprovalRequest,
  now: number,
): TaskResultReview | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const r = parsed.data,
    m = approval.resultReview;
  if (
    approval.scope?.toolName !== "operator_confirm_task_result" ||
    !m ||
    m.kind !== "task_result" ||
    m.available !== true ||
    approval.status !== "pending" ||
    approval.consumedAt !== null ||
    r.approvalId !== approval.id ||
    r.taskId !== approval.taskId ||
    r.proposalHash !== approval.scope.argsHash ||
    r.proposalHash !== m.proposalHash ||
    r.cycleNumber !== m.cycleNumber ||
    r.expiresAt !== approval.expiresAt ||
    Date.parse(r.expiresAt) <= now ||
    r.requirements.some((item) => !item.satisfied || !item.available) ||
    new Set(r.requirements.map((item) => item.tool)).size !==
      r.requirements.length ||
    !r.resultSummary.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(
      r.resultSummary,
    ) ||
    (r.resultFormat && !parseResultTable(r.resultFormat, r.resultSummary))
  )
    return null;
  return r;
}
