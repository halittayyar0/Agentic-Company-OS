import {
  deleteVmFile,
  previewVmDeletion,
  type VmDeletionPreview,
  type VmDeleteInput,
} from "@workspace/api-client-react";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const version = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 2048 &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
const bytes = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 67108864;

export function validDeletionPreview(
  value: unknown,
  path: string,
): value is VmDeletionPreview {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        !["path", "version", "entryCount", "totalBytes", "entries"].includes(
          key,
        ),
    ) ||
    value.path !== path ||
    !version(value.version) ||
    !bytes(value.totalBytes) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > 1000 ||
    value.entryCount !== value.entries.length
  )
    return false;
  const entries = new Map<string, "file" | "directory">();
  let total = 0;
  for (const entry of value.entries) {
    if (
      !object(entry) ||
      Object.keys(entry).some(
        (key) => !["path", "type", "sizeBytes"].includes(key),
      ) ||
      !validPath(entry.path) ||
      (entry.path !== path && !entry.path.startsWith(`${path}/`)) ||
      entries.has(entry.path) ||
      (entry.type !== "file" && entry.type !== "directory") ||
      !bytes(entry.sizeBytes) ||
      (entry.type === "directory" && entry.sizeBytes !== 0)
    )
      return false;
    entries.set(entry.path, entry.type);
    total += entry.sizeBytes;
  }
  if (!entries.has(path) || total !== value.totalBytes) return false;
  for (const [entry] of entries)
    if (
      entry !== path &&
      entries.get(entry.slice(0, entry.lastIndexOf("/"))) !== "directory"
    )
      return false;
  return true;
}

export async function inspectFileDeletion(agentId: number, path: string) {
  const value = await previewVmDeletion(
    agentId,
    { path },
    { signal: AbortSignal.timeout(15000) },
  );
  if (!validDeletionPreview(value, path))
    throw new Error("Invalid deletion scope");
  return value;
}

export async function deleteReviewedScope(
  agentId: number,
  input: VmDeleteInput,
) {
  const value = await deleteVmFile(agentId, input, {
    signal: AbortSignal.timeout(25000),
  });
  if (!value || value.path !== input.path || value.deleted !== true)
    throw new Error("Invalid deletion response");
  return value;
}

export type DeletionRecord = {
  id: string;
  agentId: number;
  path: string;
  expectedVersion: string;
  startedAt: string;
  status: "pending" | "unknown";
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const key = (agentId: number) => `acos.file-deletion.v1:${agentId}`;
export function readDeletionRecord(
  agentId: number,
  storage: Storage,
): { record: DeletionRecord | null; damaged: boolean } {
  try {
    const raw = storage.getItem(key(agentId));
    if (!raw || raw === "null") return { record: null, damaged: false };
    if (raw.length > 8192) throw Error("Oversized recovery data");
    const value = JSON.parse(raw);
    if (
      !object(value) ||
      Object.keys(value).some(
        (key) =>
          ![
            "id",
            "agentId",
            "path",
            "expectedVersion",
            "startedAt",
            "status",
          ].includes(key),
      ) ||
      value.agentId !== agentId ||
      typeof value.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.id,
      ) ||
      !validPath(value.path) ||
      !version(value.expectedVersion) ||
      typeof value.startedAt !== "string" ||
      !Number.isFinite(Date.parse(value.startedAt)) ||
      !["pending", "unknown"].includes(String(value.status))
    )
      throw Error("Invalid recovery data");
    return {
      record: { ...value, status: "unknown" } as DeletionRecord,
      damaged: false,
    };
  } catch {
    return { record: null, damaged: true };
  }
}
export function writeDeletionRecord(
  agentId: number,
  record: DeletionRecord | null,
  storage: Storage,
): boolean {
  try {
    const raw = JSON.stringify(record);
    if (raw.length > 8192) return false;
    storage.setItem(key(agentId), raw);
    return true;
  } catch {
    return false;
  }
}
