import type { SendCompanyRoomMessageInput } from "./company-room";
import { isLocale, type Locale } from "./i18n";
import type { CompanyRoomCopy } from "./company-room-copy";

export const ROOM_INTENT_KEY = "acos.room-send.v1";
export type RoomSendIntent = SendCompanyRoomMessageInput & {
  requestId: string;
  locale: Locale;
  mentionedAgentIds: number[];
};
export function readRoomIntent(): RoomSendIntent | null {
  try {
    const raw = sessionStorage.getItem(ROOM_INTENT_KEY);
    if (!raw || raw.length > 40000) return null;
    const value = JSON.parse(raw) as RoomSendIntent;
    if (
      !value ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.requestId,
      ) ||
      !isLocale(value.locale) ||
      typeof value.content !== "string" ||
      !value.content.trim() ||
      value.content.length > 4000 ||
      !Array.isArray(value.mentionedAgentIds) ||
      value.mentionedAgentIds.some(
        (id) => !Number.isSafeInteger(id) || id <= 0,
      ) ||
      new Set(value.mentionedAgentIds).size !== value.mentionedAgentIds.length
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function saveRoomIntent(intent: RoomSendIntent): boolean {
  try {
    sessionStorage.setItem(ROOM_INTENT_KEY, JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}
export function clearRoomIntent(): void {
  try {
    sessionStorage.removeItem(ROOM_INTENT_KEY);
  } catch {
    /* Replaying the persisted receipt remains safe. */
  }
}
export function roomSendRejection(
  error: unknown,
): keyof CompanyRoomCopy | null {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "COMPANY_REQUEST_CONFLICT") return "conflict";
  if (code === "COMPANY_REQUEST_INVALID") return "invalid";
  if (code === "COMPANY_MEMBER_CHANGED") return "invalidMention";
  if (code === "RUNTIME_CAPACITY_EXCEEDED") return "capacity";
  if (code === "EMERGENCY_STOP_ACTIVE") return "stopped";
  return null;
}
export function mentionPattern(name: string, global = false): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(^|[\\s([{])@${escaped}(?=$|[\\s,.:;!?\\])}])`,
    global ? "giu" : "iu",
  );
}
