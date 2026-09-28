import * as z from "zod/v4-mini";
import type {
  ProjectMeetingInput,
  ProjectMeetingUpdate,
  ProjectMeetingTranscriptInput,
  ProjectMeetingDecisionInput,
  ProjectMeetingActionItemInput,
  ProjectMeetingActionItemUpdate,
  ProjectMeetingCompleteInput,
  ProjectMeetingCommandResult,
  ProjectMeetingCommandReceipt,
} from "@workspace/api-client-react";
import { controlPlaneFetch } from "./auth";

type Inputs = {
  create: ProjectMeetingInput;
  update: ProjectMeetingUpdate;
  transcript: ProjectMeetingTranscriptInput;
  decision: ProjectMeetingDecisionInput;
  action: ProjectMeetingActionItemInput;
  "action-update": ProjectMeetingActionItemUpdate;
  complete: ProjectMeetingCompleteInput;
};
export type MeetingCommand = {
  [K in keyof Inputs]: {
    kind: K;
    input: Omit<Inputs[K], "requestId">;
    projectId: number;
    meetingId: number | null;
    actionItemId: number | null;
  };
}[keyof Inputs];
export type MeetingCommandIntent = MeetingCommand & {
  version: 1;
  requestId: string;
};
export type CommandStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const MEETING_COMMAND_EVENT = "acos:meeting-command";
export const meetingCommandKey = (projectId: number) =>
  `acos.meeting-command.v1:${projectId}`;
export class MeetingCommandRecoveryError extends Error {
  constructor(
    readonly code: "storage" | "pending" | "invalid" | "unconfirmed",
  ) {
    super(code);
  }
}
const positive = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 2147483647;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = z.number().check(z.int(), z.minimum(1), z.maximum(2147483647));
const text = (max: number) => z.string().check(z.maxLength(max));
const required = (max: number) =>
  text(max).check(z.refine((value) => value.trim().length > 0));
const optionalText = (max: number) => z.optional(z.nullable(text(max)));
const owner = z.optional(z.nullable(id));
const timestamp = z.optional(
  z.nullable(z.iso.datetime({ offset: true }).check(z.maxLength(64))),
);
const decision = {
  content: required(12000),
  rationale: optionalText(12000),
  ownerAgentId: owner,
};
const action = {
  title: required(500),
  details: optionalText(12000),
  ownerAgentId: owner,
  dueAt: timestamp,
};
const participantIds = z.optional(
  z.array(id).check(z.refine((ids) => new Set(ids).size === ids.length)),
);
const changes = z.refine((v: object) =>
  Object.values(v).some((value) => value !== undefined),
);
const inputs = {
  create: z.strictObject({
    title: required(200),
    agenda: optionalText(12000),
    participantAgentIds: participantIds,
    scheduledFor: timestamp,
  }),
  update: z
    .strictObject({
      title: z.optional(required(200)),
      agenda: optionalText(12000),
      participantAgentIds: participantIds,
      scheduledFor: timestamp,
      summary: optionalText(30000),
      status: z.optional(z.enum(["draft", "scheduled", "cancelled"])),
    })
    .check(changes),
  transcript: z.strictObject({
    speakerType: z.optional(z.literal("founder")),
    content: required(12000),
    replyToTranscriptId: owner,
    occurredAt: timestamp,
  }),
  decision: z.strictObject(decision),
  action: z.strictObject(action),
  "action-update": z
    .strictObject({
      ...action,
      title: z.optional(action.title),
      status: z.optional(z.enum(["open", "in_progress", "done", "cancelled"])),
    })
    .check(changes),
  complete: z.strictObject({
    summary: required(30000),
    decisions: z.optional(
      z.array(z.strictObject(decision)).check(z.maxLength(200)),
    ),
    actionItems: z.optional(
      z.array(z.strictObject(action)).check(z.maxLength(200)),
    ),
  }),
};
function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(MEETING_COMMAND_EVENT));
}
function storage(store?: CommandStore) {
  try {
    return store ?? sessionStorage;
  } catch {
    throw new MeetingCommandRecoveryError("storage");
  }
}
export function readMeetingCommandRaw(projectId: number, store?: CommandStore) {
  try {
    return storage(store).getItem(meetingCommandKey(projectId));
  } catch {
    throw new MeetingCommandRecoveryError("storage");
  }
}
function parse(raw: string, projectId: number): MeetingCommandIntent {
  try {
    if (raw.length > 1000000) throw Error();
    const r = JSON.parse(raw);
    if (
      !r ||
      r.version !== 1 ||
      r.projectId !== projectId ||
      !positive(projectId) ||
      typeof r.requestId !== "string" ||
      !uuid.test(r.requestId) ||
      r.requestId !== r.requestId.toLowerCase() ||
      !Object.hasOwn(inputs, r.kind) ||
      Object.keys(r).some(
        (k) =>
          ![
            "version",
            "requestId",
            "projectId",
            "meetingId",
            "actionItemId",
            "kind",
            "input",
          ].includes(k),
      )
    )
      throw Error();
    if (r.kind === "create" ? r.meetingId !== null : !positive(r.meetingId))
      throw Error();
    if (
      r.kind === "action-update"
        ? !positive(r.actionItemId)
        : r.actionItemId !== null
    )
      throw Error();
    if (!inputs[r.kind as keyof Inputs].safeParse(r.input).success)
      throw Error();
    // The API's limit is bytes; non-Latin text can fit the character bounds
    // while exceeding the JSON body limit. Reject before saving or dispatch.
    if (
      new TextEncoder().encode(
        JSON.stringify({ requestId: r.requestId, ...r.input }),
      ).byteLength > 1_048_576
    )
      throw Error();
    return r;
  } catch {
    throw new MeetingCommandRecoveryError("invalid");
  }
}
export function readMeetingCommand(projectId: number, store?: CommandStore) {
  const raw = readMeetingCommandRaw(projectId, store);
  return raw === null ? null : parse(raw, projectId);
}
export function prepareMeetingCommand(
  command: MeetingCommand,
  store?: CommandStore,
): MeetingCommandIntent {
  const s = storage(store);
  if (readMeetingCommand(command.projectId, s))
    throw new MeetingCommandRecoveryError("pending");
  const intent = parse(
    JSON.stringify({ ...command, version: 1, requestId: crypto.randomUUID() }),
    command.projectId,
  );
  try {
    s.setItem(meetingCommandKey(command.projectId), JSON.stringify(intent));
    if (
      JSON.stringify(readMeetingCommand(command.projectId, s)) !==
      JSON.stringify(intent)
    )
      throw Error();
  } catch {
    throw new MeetingCommandRecoveryError("storage");
  } finally {
    notify();
  }
  return intent;
}
function remove(projectId: number, s: CommandStore) {
  try {
    s.removeItem(meetingCommandKey(projectId));
    if (s.getItem(meetingCommandKey(projectId)) !== null) throw Error();
  } catch {
    throw new MeetingCommandRecoveryError("storage");
  } finally {
    notify();
  }
}
export function acknowledgeMeetingCommand(
  intent: MeetingCommandIntent,
  store?: CommandStore,
) {
  const s = storage(store),
    saved = readMeetingCommand(intent.projectId, s);
  if (!saved || saved.requestId !== intent.requestId) return false;
  if (JSON.stringify(saved) !== JSON.stringify(intent))
    throw new MeetingCommandRecoveryError("invalid");
  remove(intent.projectId, s);
  return true;
}
export function clearDamagedMeetingCommand(
  projectId: number,
  reviewedRaw: string,
  store?: CommandStore,
) {
  const s = storage(store);
  if (readMeetingCommandRaw(projectId, s) !== reviewedRaw)
    throw new MeetingCommandRecoveryError("pending");
  let damaged = false;
  try {
    parse(reviewedRaw, projectId);
  } catch {
    damaged = true;
  }
  if (!damaged) throw new MeetingCommandRecoveryError("pending");
  remove(projectId, s);
}
async function boundedFetch<T>(url: string, init: RequestInit = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await controlPlaneFetch<T>(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
export function assertMeetingCommandResult(
  value: unknown,
  intent: MeetingCommandIntent,
): asserts value is ProjectMeetingCommandResult {
  const r = value as Partial<ProjectMeetingCommandResult> | null;
  if (
    !r ||
    r.requestId !== intent.requestId ||
    r.projectId !== intent.projectId ||
    r.kind !== intent.kind ||
    typeof r.ok !== "boolean" ||
    (intent.meetingId !== null && r.meetingId !== intent.meetingId)
  )
    throw new MeetingCommandRecoveryError("unconfirmed");
  if (r.ok) {
    if (
      !positive(r.meetingId) ||
      !positive(r.entityId) ||
      (["create", "update", "complete"].includes(intent.kind) &&
        r.entityId !== r.meetingId) ||
      (intent.kind === "action-update" && r.entityId !== intent.actionItemId)
    )
      throw new MeetingCommandRecoveryError("unconfirmed");
  } else if (
    r.entityId !== null ||
    r.meetingId !== intent.meetingId ||
    typeof r.code !== "string" ||
    !r.code ||
    r.code.length > 100
  )
    throw new MeetingCommandRecoveryError("unconfirmed");
}
export async function dispatchMeetingCommand(
  intent: MeetingCommandIntent,
  store?: CommandStore,
): Promise<ProjectMeetingCommandResult> {
  // No direct dispatch from unsaved/changed input, including a stale retry dialog.
  if (
    JSON.stringify(readMeetingCommand(intent.projectId, store)) !==
    JSON.stringify(intent)
  )
    throw new MeetingCommandRecoveryError("pending");
  let path = `/api/projects/${intent.projectId}/meetings`;
  if (intent.meetingId !== null) path += `/${intent.meetingId}`;
  const suffix = {
    create: "",
    update: "",
    transcript: "/transcript",
    decision: "/decisions",
    action: "/action-items",
    "action-update": `/action-items/${intent.actionItemId}`,
    complete: "/complete",
  };
  const result = await boundedFetch<unknown>(path + suffix[intent.kind], {
    method: ["update", "action-update"].includes(intent.kind)
      ? "PATCH"
      : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: intent.requestId, ...intent.input }),
  });
  assertMeetingCommandResult(result, intent);
  if (!result.ok) throw new MeetingCommandRecoveryError("unconfirmed");
  return result;
}
export async function readMeetingCommandReceipt(
  intent: MeetingCommandIntent,
): Promise<ProjectMeetingCommandReceipt> {
  const r = await boundedFetch<ProjectMeetingCommandReceipt>(
    `/api/projects/${intent.projectId}/meeting-commands/${intent.requestId}`,
  );
  if (
    !r ||
    r.requestId !== intent.requestId ||
    r.projectId !== intent.projectId ||
    r.kind !== intent.kind ||
    ![200, 201, 400, 404, 409].includes(r.httpStatus) ||
    typeof r.createdAt !== "string" ||
    !Number.isFinite(Date.parse(r.createdAt))
  )
    throw new MeetingCommandRecoveryError("unconfirmed");
  assertMeetingCommandResult(r.response, intent);
  if (
    r.meetingId !== r.response.meetingId ||
    r.httpStatus < 300 !== r.response.ok
  )
    throw new MeetingCommandRecoveryError("unconfirmed");
  return r;
}
