import * as z from "zod/v4-mini";
import type {
  TaskInput,
  TaskCreationReceipt,
} from "@workspace/api-client-react";
import type { ComposerDraft } from "./composer-draft";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ProjectDraft = Extract<ComposerDraft, { kind: "project" }>;
export const projectStartKey = "acos.project-start.v1";
const uuid = z
  .string()
  .check(
    z.regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    ),
  );
const draftSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("project"),
  title: z.string().check(z.maxLength(300)),
  brief: z.string().check(z.maxLength(8000)),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  autonomyMode: z.enum(["finite", "continuous"]),
  cadenceSeconds: z.literal([900, 3600, 21600, 86400, 604800]),
});
const inputSchema = z.strictObject({
  requestId: uuid,
  title: z.string().check(z.minLength(1), z.maxLength(300)),
  brief: z.string().check(z.minLength(1), z.maxLength(8000)),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  autonomyMode: z.enum(["finite", "continuous"]),
  cadenceSeconds: z.optional(z.literal([900, 3600, 21600, 86400, 604800])),
});
const requestSchema = z.strictObject({
  version: z.literal(1),
  requestId: uuid,
  input: inputSchema,
  submittedDraft: draftSchema,
});
export type ProjectStartRequest = z.infer<typeof requestSchema>;
function inputFor(draft: ProjectDraft, requestId: string): TaskInput {
  return {
    requestId,
    title: draft.title.trim(),
    brief: draft.brief.trim(),
    priority: draft.priority,
    autonomyMode: draft.autonomyMode,
    ...(draft.autonomyMode === "continuous"
      ? { cadenceSeconds: draft.cadenceSeconds }
      : {}),
  };
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function parseRequest(value: unknown): ProjectStartRequest {
  const request = requestSchema.parse(value);
  if (!same(request.input, inputFor(request.submittedDraft, request.requestId)))
    throw Error("request_mismatch");
  return request;
}
export function readProjectStart(store: Store): {
  request: ProjectStartRequest | null;
  error: boolean;
} {
  try {
    const raw = store.getItem(projectStartKey);
    if (raw === null) return { request: null, error: false };
    if (raw.length > 65536) throw Error("oversized");
    return { request: parseRequest(JSON.parse(raw)), error: false };
  } catch {
    return { request: null, error: true };
  }
}
/** Dispatch is allowed only after a verified save with no prior unresolved request. */
export function beginProjectStart(
  draft: ProjectDraft,
  requestId: string,
  store: Store,
): ProjectStartRequest | null {
  try {
    const prior = readProjectStart(store);
    if (prior.error || prior.request) return null;
    const request = parseRequest({
      version: 1,
      requestId,
      input: inputFor(draft, requestId),
      submittedDraft: draft,
    });
    const raw = JSON.stringify(request);
    if (raw.length > 65536) return null;
    store.setItem(projectStartKey, raw);
    const after = readProjectStart(store);
    return !after.error && same(after.request, request) ? request : null;
  } catch {
    return null;
  }
}
export function clearProjectStart(
  request: ProjectStartRequest,
  store: Store,
): boolean {
  try {
    const prior = readProjectStart(store);
    if (prior.error || !same(prior.request, request)) return false;
    store.removeItem(projectStartKey);
    return store.getItem(projectStartKey) === null;
  } catch {
    return false;
  }
}
const failure = z.literal([
  "EMERGENCY_STOP_ACTIVE",
  "AGENT_UNAVAILABLE",
  "RUNTIME_CAPACITY_EXCEEDED",
  "EXECUTION_POLICY_DENIED",
]);
const receiptSchema = z.strictObject({
  requestId: uuid,
  state: z.enum(["created", "rejected"]),
  taskId: z.nullable(
    z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
  ),
  failureCode: z.nullable(failure),
  createdAt: z.string().check(z.iso.datetime({ offset: true })),
});
/** A created receipt says nothing about completion of the requested work. */
export function acceptProjectReceipt(
  value: unknown,
  requestId: string,
): TaskCreationReceipt | null {
  const result = receiptSchema.safeParse(value);
  if (!result.success) return null;
  const receipt = result.data;
  if (receipt.requestId !== requestId) return null;
  if (
    receipt.state === "created"
      ? receipt.taskId === null || receipt.failureCode !== null
      : receipt.taskId !== null || receipt.failureCode === null
  )
    return null;
  return receipt;
}
