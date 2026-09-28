import type { VmWriteResult } from "@workspace/api-client-react";

export type FileDraft = {
  path: string;
  content: string;
  baseContent: string;
  version: string;
  needsReview: boolean;
};
export type FileWriteRecord = {
  id: string;
  agentId: number;
  kind: "edit" | "create";
  path: string;
  content: string;
  expectedVersion: string;
  status: "pending" | "unknown";
  startedAt: string;
};
export type FileSession = {
  agentId: number;
  drafts: FileDraft[];
  newPath: string;
  request: FileWriteRecord | null;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const key = (agentId: number) => `acos.file-editor.v1:${agentId}`;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const fields = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum;
const version = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const validFilePath = (value: unknown): value is string =>
  text(value, 2048) &&
  value.length > 0 &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
export function editableFileText(value: unknown): value is string {
  if (!text(value, 131072) || value.includes("\0")) return false;
  const bytes = new TextEncoder().encode(value);
  return (
    bytes.length <= 131072 &&
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) === value
  );
}
export const emptyFileSession = (agentId: number): FileSession => ({
  agentId,
  drafts: [],
  newPath: "",
  request: null,
});
export function readFileSession(
  agentId: number,
  storage: Storage,
): { session: FileSession; damaged: boolean } {
  try {
    const raw = storage.getItem(key(agentId));
    if (!raw) return { session: emptyFileSession(agentId), damaged: false };
    if (raw.length > 1_000_000) throw Error("Oversized file session");
    const value = JSON.parse(raw);
    if (
      !object(value) ||
      !fields(value, ["agentId", "drafts", "newPath", "request"]) ||
      value.agentId !== agentId ||
      !text(value.newPath, 100000) ||
      !Array.isArray(value.drafts) ||
      value.drafts.length > 100
    )
      throw Error("Invalid file session");
    const paths = new Set<string>();
    for (const draft of value.drafts) {
      if (
        !object(draft) ||
        !fields(draft, [
          "path",
          "content",
          "baseContent",
          "version",
          "needsReview",
        ]) ||
        !validFilePath(draft.path) ||
        paths.has(draft.path) ||
        !text(draft.content, 1_000_000) ||
        !editableFileText(draft.baseContent) ||
        !version(draft.version) ||
        typeof draft.needsReview !== "boolean"
      )
        throw Error("Invalid draft");
      paths.add(draft.path);
    }
    const r = value.request;
    if (
      r !== null &&
      (!object(r) ||
        !fields(r, [
          "id",
          "agentId",
          "kind",
          "path",
          "content",
          "expectedVersion",
          "status",
          "startedAt",
        ]) ||
        r.agentId !== agentId ||
        !text(r.id, 36) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          r.id,
        ) ||
        !validFilePath(r.path) ||
        !editableFileText(r.content) ||
        !["pending", "unknown"].includes(String(r.status)) ||
        !text(r.startedAt, 40) ||
        !Number.isFinite(Date.parse(r.startedAt)) ||
        (r.kind === "create"
          ? r.expectedVersion !== "missing" || r.content !== ""
          : r.kind !== "edit" || !version(r.expectedVersion)))
    )
      throw Error("Invalid pending write");
    return { session: value as FileSession, damaged: false };
  } catch {
    return { session: emptyFileSession(agentId), damaged: true };
  }
}

/** A newly mounted view cannot know that another page's request completed. */
export function recoverFileSession(session: FileSession): FileSession {
  return {
    ...session,
    drafts: session.drafts.map((draft) => ({ ...draft, needsReview: true })),
    request: session.request ? { ...session.request, status: "unknown" } : null,
  };
}
export function writeFileSession(
  session: FileSession,
  storage: Storage,
): boolean {
  try {
    const raw = JSON.stringify(session);
    if (
      raw.length > 1_000_000 ||
      session.drafts.length > 100 ||
      session.newPath.length > 100000
    )
      return false;
    storage.setItem(key(session.agentId), raw);
    return true;
  } catch {
    return false;
  }
}

/** Merge only this request's result; retain edits made while it was in flight. */
export function settleFileWrite(
  session: FileSession,
  request: FileWriteRecord,
  result?: VmWriteResult,
): FileSession {
  if (session.request?.id !== request.id) return session;
  if (!result)
    return {
      ...session,
      request: { ...request, status: "unknown" },
      drafts: session.drafts.map((draft) =>
        draft.path === request.path ? { ...draft, needsReview: true } : draft,
      ),
    };
  return {
    ...session,
    request: null,
    newPath:
      request.kind === "create" && session.newPath === request.path
        ? ""
        : session.newPath,
    drafts: session.drafts.flatMap((draft) =>
      draft.path !== request.path
        ? [draft]
        : draft.content === request.content
          ? []
          : [
              {
                ...draft,
                baseContent: request.content,
                version: result.version,
                needsReview: false,
              },
            ],
    ),
  };
}
