import type { VmExecResult } from "@workspace/api-client-react";
import { LOCALES, type Locale } from "./i18n";

export const TERMINAL_COMMAND_LIMIT = 32768;
export type TerminalMode = "sandbox" | "founder";
export type TerminalRecord = {
  id: string;
  agentId: number;
  command: string;
  mode: TerminalMode;
  startedAt: string;
  status: "pending" | "unknown" | "returned";
  result?: VmExecResult;
} & (
  | { protocolVersion?: 1; locale?: never }
  | { protocolVersion: 2; locale: Locale }
);
export type TerminalSession = {
  agentId: number;
  drafts: Record<TerminalMode, string>;
  record: TerminalRecord | null;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export function sameTerminalRecord(
  left: TerminalRecord | null,
  right: TerminalRecord | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.agentId === right.agentId &&
    left.mode === right.mode &&
    left.command === right.command &&
    left.startedAt === right.startedAt &&
    left.protocolVersion === right.protocolVersion &&
    left.locale === right.locale
  );
}
const key = (id: number) => `acos.terminal.v1:${id}`;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit;

export function validTerminalResult(value: unknown): value is VmExecResult {
  return (
    object(value) &&
    Object.keys(value).every((key) =>
      [
        "ok",
        "exitCode",
        "stdout",
        "stderr",
        "durationMs",
        "note",
        "cwd",
      ].includes(key),
    ) &&
    typeof value.ok === "boolean" &&
    (value.exitCode === null ||
      (typeof value.exitCode === "number" &&
        Number.isInteger(value.exitCode) &&
        value.exitCode >= -2147483648 &&
        value.exitCode <= 2147483647)) &&
    (!value.ok || value.exitCode === 0) &&
    text(value.stdout, 262144) &&
    text(value.stderr, 262144) &&
    typeof value.durationMs === "number" &&
    Number.isInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 86400000 &&
    (value.note === null || text(value.note, 8192)) &&
    (value.cwd === null || text(value.cwd, 4096))
  );
}

export function emptyTerminalSession(agentId: number): TerminalSession {
  return { agentId, drafts: { sandbox: "", founder: "" }, record: null };
}

export function readTerminalSession(
  agentId: number,
  storage: Pick<Storage, "getItem">,
): {
  session: TerminalSession;
  damaged: boolean;
} {
  try {
    const raw = storage.getItem(key(agentId));
    if (!raw) return { session: emptyTerminalSession(agentId), damaged: false };
    if (raw.length > 1_000_000) throw new Error("Oversized terminal data");
    const value = JSON.parse(raw);
    if (
      !object(value) ||
      Object.keys(value).some(
        (key) => !["agentId", "drafts", "record"].includes(key),
      ) ||
      value.agentId !== agentId ||
      !object(value.drafts) ||
      Object.keys(value.drafts).some(
        (key) => !["sandbox", "founder"].includes(key),
      ) ||
      !text(value.drafts.sandbox, 1_000_000) ||
      !text(value.drafts.founder, 1_000_000)
    )
      throw new Error("Invalid terminal drafts");
    const record = value.record;
    if (
      record !== null &&
      (!object(record) ||
        Object.keys(record).some(
          (key) =>
            ![
              "id",
              "agentId",
              "command",
              "mode",
              "startedAt",
              "status",
              "result",
              "protocolVersion",
              "locale",
            ].includes(key),
        ) ||
        record.agentId !== agentId ||
        (record.protocolVersion === 2
          ? !LOCALES.some((locale) => locale === record.locale)
          : (record.protocolVersion !== undefined &&
              record.protocolVersion !== 1) ||
            Object.hasOwn(record, "locale")) ||
        typeof record.id !== "string" ||
        !uuid.test(record.id) ||
        !text(record.command, TERMINAL_COMMAND_LIMIT) ||
        !record.command.trim() ||
        (record.mode !== "sandbox" && record.mode !== "founder") ||
        typeof record.startedAt !== "string" ||
        !Number.isFinite(Date.parse(record.startedAt)) ||
        typeof record.status !== "string" ||
        !["pending", "unknown", "returned"].includes(record.status) ||
        (record.status === "returned"
          ? !validTerminalResult(record.result)
          : record.result !== undefined))
    )
      throw new Error("Invalid terminal record");
    // A previous page cannot still observe its request; never re-dispatch it.
    if (record && record.status === "pending") record.status = "unknown";
    return { session: value as TerminalSession, damaged: false };
  } catch {
    return { session: emptyTerminalSession(agentId), damaged: true };
  }
}

export function writeTerminalSession(
  session: TerminalSession,
  storage: Storage,
): boolean {
  try {
    const raw = JSON.stringify(session);
    if (raw.length > 1_000_000) return false;
    storage.setItem(key(session.agentId), raw);
    return storage.getItem(key(session.agentId)) === raw;
  } catch {
    return false;
  }
}
