import type {
  ProjectMeetingStartInput,
  ProjectMeetingStartResponse,
  ProjectMeetingTurnReceipt,
} from "@workspace/api-client-react";
import { controlPlaneFetch } from "./auth";

export type MeetingTurnInput = Omit<ProjectMeetingStartInput, "requestId">;
export type MeetingTurnIntent = {
  version: 1;
  projectId: number;
  meetingId: number;
  requestId: string;
  input: MeetingTurnInput;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type InventoryStore = Store & Pick<Storage, "length" | "key">;
export type MeetingTurnRecord =
  | { kind: "valid"; key: string; raw: string; intent: MeetingTurnIntent }
  | { kind: "damaged"; key: string; raw: string };
export const MEETING_TURN_PAGE_SIZE = 20;
export const MEETING_TURN_EVENT = "acos:meeting-turn";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positive = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 2147483647;
export function meetingTurnKey(projectId: number, meetingId: number) {
  return `acos.meeting-turn.v1:${projectId}:${meetingId}`;
}
export class MeetingTurnRecoveryError extends Error {
  constructor(
    readonly code: "storage" | "pending" | "invalid" | "unconfirmed",
  ) {
    super(code);
  }
}
function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(MEETING_TURN_EVENT));
}
function resolveStore(storage?: Store): Store {
  try {
    return storage ?? sessionStorage;
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
}
function parseIntent(
  raw: string,
  projectId: number,
  meetingId: number,
): MeetingTurnIntent {
  try {
    if (raw.length > 100000) throw new Error();
    const r = JSON.parse(raw),
      i = r?.input;
    if (
      !r ||
      typeof r !== "object" ||
      Array.isArray(r) ||
      Object.keys(r).some(
        (key) =>
          !["version", "projectId", "meetingId", "requestId", "input"].includes(
            key,
          ),
      ) ||
      r.version !== 1 ||
      r.projectId !== projectId ||
      r.meetingId !== meetingId ||
      !positive(projectId) ||
      !positive(meetingId) ||
      typeof r.requestId !== "string" ||
      !uuid.test(r.requestId) ||
      !i ||
      typeof i !== "object" ||
      Array.isArray(i) ||
      Object.keys(i).some(
        (key) =>
          !["prompt", "participantAgentIds", "maxTokensPerResponse"].includes(
            key,
          ),
      ) ||
      (i.prompt !== undefined &&
        (typeof i.prompt !== "string" ||
          !i.prompt.trim() ||
          i.prompt.length > 12000)) ||
      (i.participantAgentIds !== undefined &&
        (!Array.isArray(i.participantAgentIds) ||
          i.participantAgentIds.length > 2000 ||
          !i.participantAgentIds.every(positive) ||
          new Set(i.participantAgentIds).size !==
            i.participantAgentIds.length)) ||
      (i.maxTokensPerResponse !== undefined &&
        (!Number.isInteger(i.maxTokensPerResponse) ||
          i.maxTokensPerResponse < 100 ||
          i.maxTokensPerResponse > 600))
    )
      throw new Error();
    return {
      version: 1,
      projectId,
      meetingId,
      requestId: r.requestId,
      input: {
        ...(i.prompt === undefined ? {} : { prompt: i.prompt }),
        ...(i.participantAgentIds === undefined
          ? {}
          : { participantAgentIds: i.participantAgentIds }),
        ...(i.maxTokensPerResponse === undefined
          ? {}
          : { maxTokensPerResponse: i.maxTokensPerResponse }),
      },
    };
  } catch {
    throw new MeetingTurnRecoveryError("invalid");
  }
}
export function readMeetingTurnIntent(
  projectId: number,
  meetingId: number,
  store?: Store,
): MeetingTurnIntent | null {
  if (!positive(projectId) || !positive(meetingId))
    throw new MeetingTurnRecoveryError("invalid");
  const storage = resolveStore(store);
  let raw: string | null;
  try {
    raw = storage.getItem(meetingTurnKey(projectId, meetingId));
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
  if (raw === null) return null;
  return parseIntent(raw, projectId, meetingId);
}
export function prepareMeetingTurn(
  projectId: number,
  meetingId: number,
  input: MeetingTurnInput,
  store?: Store,
): MeetingTurnIntent {
  const storage = resolveStore(store);
  if (readMeetingTurnIntent(projectId, meetingId, storage))
    throw new MeetingTurnRecoveryError("pending");
  const intent = parseIntent(
    JSON.stringify({
      version: 1,
      projectId,
      meetingId,
      requestId: crypto.randomUUID(),
      input,
    }),
    projectId,
    meetingId,
  );
  try {
    storage.setItem(
      meetingTurnKey(projectId, meetingId),
      JSON.stringify(intent),
    );
    const saved = readMeetingTurnIntent(projectId, meetingId, storage);
    if (JSON.stringify(saved) !== JSON.stringify(intent)) throw new Error();
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
  notify();
  return intent;
}
export function acknowledgeMeetingTurn(
  intent: MeetingTurnIntent,
  store?: Store,
) {
  const storage = resolveStore(store);
  const saved = readMeetingTurnIntent(
    intent.projectId,
    intent.meetingId,
    storage,
  );
  if (!saved || saved.requestId !== intent.requestId) return false;
  if (
    JSON.stringify(saved) !==
    JSON.stringify(
      parseIntent(JSON.stringify(intent), intent.projectId, intent.meetingId),
    )
  )
    throw new MeetingTurnRecoveryError("pending");
  try {
    storage.removeItem(meetingTurnKey(intent.projectId, intent.meetingId));
    if (
      storage.getItem(meetingTurnKey(intent.projectId, intent.meetingId)) !==
      null
    )
      throw new Error();
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
  notify();
  return true;
}

function projectPrefix(projectId: number) {
  if (!positive(projectId)) throw new MeetingTurnRecoveryError("invalid");
  return `acos.meeting-turn.v1:${projectId}:`;
}
function parseRecord(
  projectId: number,
  key: string,
  raw: string,
): MeetingTurnRecord {
  const suffix = key.slice(projectPrefix(projectId).length),
    meetingId = Number(suffix);
  try {
    if (!positive(meetingId) || String(meetingId) !== suffix) throw Error();
    return {
      kind: "valid",
      key,
      raw,
      intent: parseIntent(raw, projectId, meetingId),
    };
  } catch {
    return { kind: "damaged", key, raw };
  }
}
export function listMeetingTurnRecords(
  projectId: number,
  {
    offset = 0,
    scanLimit = 1000,
  }: { offset?: number; scanLimit?: number } = {},
  store?: InventoryStore,
) {
  const prefix = projectPrefix(projectId);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(scanLimit) ||
    scanLimit < 1
  )
    throw new MeetingTurnRecoveryError("invalid");
  try {
    const s = store ?? sessionStorage;
    const length = s.length;
    if (!Number.isSafeInteger(length) || length < 0) throw Error();
    const keys = new Set<string>();
    const inspected = Math.min(length, scanLimit);
    for (let index = 0; index < inspected; index++) {
      const key = s.key(index);
      if (key === null) throw Error();
      if (key.startsWith(prefix)) keys.add(key);
    }
    if (s.length !== length) throw Error();
    const sorted = [...keys].sort();
    const records = sorted
      .slice(offset, offset + MEETING_TURN_PAGE_SIZE)
      .map((key) => {
        const raw = s.getItem(key);
        if (raw === null) throw Error();
        return parseRecord(projectId, key, raw);
      });
    return {
      records,
      totalKnown: sorted.length,
      hasMore: offset + MEETING_TURN_PAGE_SIZE < sorted.length,
      scanIncomplete: inspected < length,
    };
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
}
export function clearDamagedMeetingTurn(
  projectId: number,
  key: string,
  reviewedRaw: string,
  store?: Store,
) {
  if (!key.startsWith(projectPrefix(projectId)))
    throw new MeetingTurnRecoveryError("invalid");
  const s = resolveStore(store);
  let current: string | null;
  try {
    current = s.getItem(key);
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
  if (
    current !== reviewedRaw ||
    parseRecord(projectId, key, reviewedRaw).kind !== "damaged"
  )
    throw new MeetingTurnRecoveryError("pending");
  try {
    s.removeItem(key);
    if (s.getItem(key) !== null) throw Error();
  } catch {
    throw new MeetingTurnRecoveryError("storage");
  }
  notify();
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
export function assertMeetingTurnResult(
  value: unknown,
  intent: MeetingTurnIntent,
): asserts value is ProjectMeetingStartResponse {
  const r = value as Partial<ProjectMeetingStartResponse> | null;
  if (
    !r ||
    r.requestId !== intent.requestId ||
    r.meeting?.id !== intent.meetingId ||
    r.meeting?.taskId !== intent.projectId ||
    !["draft", "scheduled", "in_progress", "completed", "cancelled"].includes(
      r.meeting.status,
    ) ||
    !Array.isArray(r.agentTranscriptIds) ||
    !Array.isArray(r.skippedParticipants) ||
    !Array.isArray(r.transcript) ||
    !Array.isArray(r.participants) ||
    !Array.isArray(r.decisions) ||
    !Array.isArray(r.actionItems) ||
    !r.execution
  )
    throw new MeetingTurnRecoveryError("unconfirmed");
  const e = r.execution;
  const integer = (n: unknown, min: number, max: number) =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
  if (
    !integer(e.requestedParticipantCount, 0, 2147483647) ||
    !integer(e.attemptedParticipantCount, 0, e.requestedParticipantCount) ||
    !integer(e.maxRespondersPerStart, 1, 32) ||
    e.attemptedParticipantCount > e.maxRespondersPerStart ||
    !integer(e.maxConcurrentMeetingStarts, 1, 16) ||
    !integer(e.maxTokensPerResponse, 100, 600) ||
    !r.agentTranscriptIds.every(positive) ||
    new Set(r.agentTranscriptIds).size !== r.agentTranscriptIds.length ||
    !r.transcript.every(
      (row) =>
        row &&
        typeof row.content === "string" &&
        ["agent", "founder"].includes(row.speakerType) &&
        (row.speakerName == null || typeof row.speakerName === "string"),
    ) ||
    ![...r.transcript, ...r.decisions, ...r.actionItems].every(
      (row) => row && positive(row.id) && row.meetingId === intent.meetingId,
    ) ||
    !r.participants.every(
      (row) =>
        row && positive(row.agentId) && row.meetingId === intent.meetingId,
    ) ||
    !r.skippedParticipants.every(
      (row) =>
        row &&
        positive(row.agentId) &&
        [
          "busy",
          "unavailable",
          "empty_response",
          "model_error",
          "provider_unavailable",
          "budget_guard",
        ].includes(row.reason),
    )
  )
    throw new MeetingTurnRecoveryError("unconfirmed");
  const recorded = new Set(
    r.transcript
      .filter((row) => row.speakerType === "agent")
      .map((row) => row.id),
  );
  if (!r.agentTranscriptIds.every((id) => recorded.has(id)))
    throw new MeetingTurnRecoveryError("unconfirmed");
}
/** Explicit dispatch only. The caller must retain the intent until it reviews a receipt. */
export async function dispatchMeetingTurn(
  intent: MeetingTurnIntent,
): Promise<ProjectMeetingStartResponse> {
  const stored = readMeetingTurnIntent(intent.projectId, intent.meetingId);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(intent))
    throw new MeetingTurnRecoveryError("invalid");
  const result = await boundedFetch<unknown>(
    `/api/projects/${intent.projectId}/meetings/${intent.meetingId}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...intent.input, requestId: intent.requestId }),
    },
  );
  assertMeetingTurnResult(result, intent);
  return result;
}
export async function readMeetingTurnReceipt(
  intent: MeetingTurnIntent,
): Promise<ProjectMeetingTurnReceipt> {
  const receipt = await boundedFetch<ProjectMeetingTurnReceipt>(
    `/api/projects/${intent.projectId}/meetings/${intent.meetingId}/turn-requests/${intent.requestId}`,
  );
  if (
    !receipt ||
    receipt.requestId !== intent.requestId ||
    receipt.projectId !== intent.projectId ||
    receipt.meetingId !== intent.meetingId ||
    !["running", "complete", "unconfirmed"].includes(receipt.state)
  )
    throw new MeetingTurnRecoveryError("invalid");
  if (receipt.state === "complete") {
    if (
      !Number.isInteger(receipt.httpStatus) ||
      receipt.httpStatus! < 200 ||
      receipt.httpStatus! > 599
    )
      throw new MeetingTurnRecoveryError("invalid");
    assertMeetingTurnResult(receipt.response, intent);
  } else if (receipt.httpStatus !== null || receipt.response !== null) {
    throw new MeetingTurnRecoveryError("invalid");
  }
  return receipt;
}
