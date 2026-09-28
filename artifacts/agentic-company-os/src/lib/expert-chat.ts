import {
  getAgentRequest,
  sendAgentRequest,
  type AgentRequestInput,
  type AgentRequestReceipt,
  type Message,
} from "@workspace/api-client-react";
import { isLocale } from "./i18n";

export const CHAT_PAGE_SIZE = 50;
export const CHAT_WINDOW_LIMIT = 500;
export type ChatKind = AgentRequestInput["kind"];
export type ChatIntent = {
  agentId: number;
  input: AgentRequestInput & { expectedConfig: string };
};
export type ChatPage = { messages: Message[]; beforeId: number | null };
const scopeKey = (agentId: number, taskId?: number) =>
  taskId === undefined ? String(agentId) : `${agentId}:project:${taskId}`;
const key = (agentId: number, taskId?: number) =>
  `acos.expert-send.v1:${scopeKey(agentId, taskId)}`;
const draftKey = (agentId: number, taskId?: number) =>
  `acos.expert-draft.v1:${scopeKey(agentId, taskId)}`;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positive = (id: unknown): id is number =>
  Number.isSafeInteger(id) && Number(id) > 0;
export const isChatKind = (value: unknown): value is ChatKind =>
  value === "ask" || value === "delegate" || value === "continuous";

export function readChatIntent(
  agentId: number,
  taskId?: number,
): {
  intent: ChatIntent | null;
  damaged: boolean;
} {
  try {
    const raw = sessionStorage.getItem(key(agentId, taskId));
    if (!raw) return { intent: null, damaged: false };
    if (raw.length > 210000) throw new Error("Invalid saved intent");
    const value = JSON.parse(raw) as ChatIntent;
    const input = value?.input;
    if (
      value?.agentId !== agentId ||
      !input ||
      input.taskId !== taskId ||
      (taskId !== undefined && (!positive(taskId) || input.kind !== "ask")) ||
      Object.keys(input).some(
        (field) =>
          ![
            "requestId",
            "kind",
            "locale",
            "content",
            "expectedConfig",
            "modelMode",
            "modelId",
            "taskId",
          ].includes(field),
      ) ||
      !uuid.test(input.requestId) ||
      !isLocale(input.locale) ||
      !isChatKind(input.kind) ||
      typeof input.content !== "string" ||
      !input.content.trim() ||
      input.content.length > (input.kind === "ask" ? 32768 : 8000) ||
      !/^[a-f0-9]{64}$/.test(input.expectedConfig) ||
      (input.modelMode !== undefined &&
        input.modelMode !== "auto" &&
        input.modelMode !== "manual") ||
      (input.modelMode === "manual" &&
        (typeof input.modelId !== "string" ||
          !input.modelId.trim() ||
          input.modelId.length > 256)) ||
      (input.modelId !== undefined && input.modelMode !== "manual") ||
      (input.kind !== "ask" &&
        (input.modelId !== undefined || input.modelMode !== undefined))
    )
      throw new Error("Invalid saved intent");
    return { intent: value, damaged: false };
  } catch {
    return { intent: null, damaged: true };
  }
}
export function saveChatIntent(intent: ChatIntent): boolean {
  try {
    sessionStorage.setItem(
      key(intent.agentId, intent.input.taskId),
      JSON.stringify(intent),
    );
    return (
      readChatIntent(intent.agentId, intent.input.taskId).intent?.input
        .requestId === intent.input.requestId
    );
  } catch {
    return false;
  }
}
export function clearChatIntent(
  agentId: number,
  taskId?: number,
  expectedRequestId?: string,
): boolean {
  try {
    if (
      expectedRequestId &&
      readChatIntent(agentId, taskId).intent?.input.requestId !==
        expectedRequestId
    )
      return false;
    sessionStorage.removeItem(key(agentId, taskId));
    return sessionStorage.getItem(key(agentId, taskId)) === null;
  } catch {
    return false;
  }
}
export function readChatDraft(
  agentId: number,
  taskId?: number,
): { content: string; kind: ChatKind } | null {
  try {
    const raw = sessionStorage.getItem(draftKey(agentId, taskId));
    if (!raw || raw.length > 210000) return null;
    const draft = JSON.parse(raw) as { content: string; kind: ChatKind };
    return typeof draft.content === "string" &&
      draft.content.length <= 32768 &&
      isChatKind(draft.kind) &&
      (taskId === undefined || draft.kind === "ask")
      ? draft
      : null;
  } catch {
    return null;
  }
}
export function saveChatDraft(
  agentId: number,
  content: string,
  kind: ChatKind,
  taskId?: number,
): boolean {
  try {
    if (content.length > 32768 || (taskId !== undefined && kind !== "ask"))
      return false;
    sessionStorage.setItem(
      draftKey(agentId, taskId),
      JSON.stringify({ content, kind }),
    );
    return true;
  } catch {
    return false;
  }
}

function validMessage(
  value: unknown,
  agentId: number,
  taskId?: number,
): value is Message {
  if (!value || typeof value !== "object") return false;
  const m = value as Message;
  return (
    positive(m.id) &&
    m.agentId === agentId &&
    ["user", "agent", "system"].includes(m.role) &&
    typeof m.content === "string" &&
    m.taskId === (taskId ?? null) &&
    (m.modelId === null || typeof m.modelId === "string") &&
    typeof m.createdAt === "string" &&
    Number.isFinite(Date.parse(m.createdAt))
  );
}
export async function fetchChatPage(
  agentId: number,
  beforeId?: number,
  signal?: AbortSignal,
  taskId?: number,
): Promise<ChatPage> {
  const query = new URLSearchParams({ limit: String(CHAT_PAGE_SIZE) });
  if (taskId !== undefined) query.set("taskId", String(taskId));
  if (beforeId !== undefined) query.set("beforeId", String(beforeId));
  const response = await fetch(`/api/agents/${agentId}/messages?${query}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (response.status === 401)
    window.dispatchEvent(new Event("agenticos:unauthorized"));
  if (!response.ok) throw new Error("History unavailable");
  const body: unknown = await response.json();
  if (
    !Array.isArray(body) ||
    body.length > CHAT_PAGE_SIZE ||
    body.some(
      (m) =>
        !validMessage(m, agentId, taskId) ||
        (beforeId !== undefined && m.id >= beforeId),
    ) ||
    new Set(body.map((m) => m.id)).size !== body.length
  )
    throw new Error("Invalid history");
  const header = response.headers.get("X-Next-Before-Id");
  const cursor = header === null ? null : Number(header);
  if (
    cursor !== null &&
    (!/^[1-9]\d*$/.test(header!) ||
      !positive(cursor) ||
      !body.length ||
      cursor !== Math.min(...body.map((m) => m.id)))
  )
    throw new Error("Invalid history cursor");
  return {
    messages: (body as Message[]).sort((a, b) => a.id - b.id),
    beforeId: cursor,
  };
}

export function validateChatReceipt(
  value: unknown,
  intent: ChatIntent,
): AgentRequestReceipt {
  if (!value || typeof value !== "object") throw new Error("Invalid receipt");
  const r = value as AgentRequestReceipt;
  const input = intent.input;
  const outcomes = [
    "unconfirmed",
    "rejected",
    "queued",
    "reply",
    "provider_error",
    "empty_response",
    "tool_limit",
    "tool_outcome_unknown",
    "tool_deferred",
    "approval_review",
    "round_limit",
  ];
  if (
    r.requestId !== input.requestId ||
    r.agentId !== intent.agentId ||
    r.kind !== input.kind ||
    r.taskId !== input.taskId ||
    !["complete", "unconfirmed", "rejected"].includes(r.deliveryState) ||
    !outcomes.includes(r.outcome) ||
    typeof r.replayed !== "boolean" ||
    !Array.isArray(r.createdTasks) ||
    !Array.isArray(r.createdAgents) ||
    r.createdTasks.some((task) => !positive(task?.id)) ||
    r.createdAgents.some((agent) => !positive(agent?.id))
  )
    throw new Error("Receipt does not match intent");
  if (
    r.userMessage !== undefined &&
    (!validMessage(r.userMessage, intent.agentId, input.taskId) ||
      r.userMessage.role !== "user" ||
      r.userMessage.content !== input.content)
  )
    throw new Error("Invalid admission record");
  if (
    r.agentMessage !== undefined &&
    (!validMessage(r.agentMessage, intent.agentId, input.taskId) ||
      r.agentMessage.role === "user")
  )
    throw new Error("Invalid reply record");
  if (
    (r.usedModel != null && typeof r.usedModel !== "string") ||
    (r.usedProvider != null && typeof r.usedProvider !== "string") ||
    (r.usedModel != null &&
      r.agentMessage !== undefined &&
      r.usedModel !== r.agentMessage.modelId)
  )
    throw new Error("Invalid model record");
  if (r.deliveryState !== "complete") {
    if (
      r.outcome !== r.deliveryState ||
      r.agentMessage ||
      r.task ||
      (r.deliveryState === "rejected" &&
        (r.userMessage || typeof r.failureCode !== "string"))
    )
      throw new Error("Invalid incomplete receipt");
  } else if (input.kind === "ask") {
    if (
      !r.userMessage ||
      !r.agentMessage ||
      ["unconfirmed", "rejected", "queued"].includes(r.outcome) ||
      r.agentMessage.role !== (r.outcome === "reply" ? "agent" : "system")
    )
      throw new Error("Incomplete reply receipt");
  } else if (
    r.outcome !== "queued" ||
    !r.task ||
    !positive(r.task.id) ||
    r.task.ownerAgentId !== intent.agentId ||
    r.task.brief !== input.content ||
    r.task.autonomyMode !==
      (input.kind === "continuous" ? "continuous" : "finite")
  )
    throw new Error("Incomplete project receipt");
  return r;
}
export async function postChatIntent(intent: ChatIntent) {
  return validateChatReceipt(
    await sendAgentRequest(intent.agentId, intent.input, {
      signal: AbortSignal.timeout(90000),
    }),
    intent,
  );
}
export async function getChatReceipt(intent: ChatIntent, signal?: AbortSignal) {
  return validateChatReceipt(
    await getAgentRequest(intent.agentId, intent.input.requestId, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    }),
    intent,
  );
}
export function chatErrorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}
