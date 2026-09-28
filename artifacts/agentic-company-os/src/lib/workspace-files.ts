import {
  readVmFile,
  writeVmFile,
  listVmFiles,
  type VmFileContent,
  type VmWriteInput,
} from "@workspace/api-client-react";
import { editableFileText, validFilePath } from "./file-session";

export function fileErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { data?: { code?: unknown } };
  return String(value.data?.code ?? "");
}

export async function readFileListing(agentId: number, path: string) {
  const value = await listVmFiles(
    agentId,
    { path },
    { signal: AbortSignal.timeout(15000) },
  );
  const paths = new Set<string>();
  if (
    value.path !== path ||
    !Array.isArray(value.entries) ||
    value.entries.length > 2000 ||
    value.total !== value.entries.length ||
    value.entries.some((entry) => {
      if (
        !validFilePath(entry.path) ||
        entry.path.slice(
          0,
          entry.path.lastIndexOf("/") < 0 ? 0 : entry.path.lastIndexOf("/"),
        ) !== path ||
        entry.name !== entry.path.split("/").at(-1) ||
        paths.has(entry.path) ||
        !["file", "directory"].includes(entry.type) ||
        !Number.isSafeInteger(entry.sizeBytes) ||
        entry.sizeBytes < 0 ||
        !Number.isFinite(Date.parse(String(entry.updatedAt)))
      )
        return true;
      paths.add(entry.path);
      return false;
    }) ||
    (value.truncated !== undefined && typeof value.truncated !== "boolean") ||
    (value.skipped !== undefined &&
      (!Number.isSafeInteger(value.skipped) || value.skipped < 0))
  )
    throw Error("Invalid directory snapshot");
  return {
    ...value,
    complete: value.truncated === false && value.skipped === 0,
  };
}

/** A textarea normalizes CRLF and lone CR to LF. Apply its single changed
 * range to the source, preserving every untouched line ending and choosing
 * the source's first line ending for newly inserted lines. Linear in size.
 */
export function applyFileTextEdit(source: string, value: string): string {
  const display = source.replace(/\r\n?/g, "\n");
  if (display === value) return source;
  let start = 0;
  while (
    start < display.length &&
    start < value.length &&
    display[start] === value[start]
  )
    start++;
  let end = 0;
  while (
    end < display.length - start &&
    end < value.length - start &&
    display[display.length - 1 - end] === value[value.length - 1 - end]
  )
    end++;
  function sourceOffset(normalized: number) {
    let index = 0;
    for (let offset = 0; offset < normalized; offset++) {
      if (source[index] === "\r" && source[index + 1] === "\n") index++;
      index++;
    }
    return index;
  }
  const newline = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  const insertion = value
    .slice(start, value.length - end)
    .replace(/\n/g, newline);
  return (
    source.slice(0, sourceOffset(start)) +
    insertion +
    source.slice(sourceOffset(display.length - end))
  );
}

export async function readSnapshot(
  agentId: number,
  path: string,
): Promise<VmFileContent> {
  const value = await readVmFile(
    agentId,
    { path },
    { signal: AbortSignal.timeout(15000) },
  );
  if (
    value.path !== path ||
    typeof value.content !== "string" ||
    value.content.length > 131072 ||
    !/^[a-f0-9]{64}$/.test(value.version) ||
    typeof value.editable !== "boolean" ||
    typeof value.truncated !== "boolean" ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 0 ||
    value.sizeBytes > 262144 ||
    (value.editable &&
      (value.truncated ||
        !editableFileText(value.content) ||
        new TextEncoder().encode(value.content).byteLength !==
          value.sizeBytes ||
        value.sizeBytes > 131072))
  )
    throw new Error("Invalid file snapshot");
  return value;
}

export async function writeReviewedFile(agentId: number, input: VmWriteInput) {
  const bytes = new TextEncoder().encode(input.content);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const expected = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const value = await writeVmFile(agentId, input, {
    signal: AbortSignal.timeout(20000),
  });
  if (
    value.path !== input.path ||
    value.version !== expected ||
    value.sizeBytes !== bytes.byteLength
  )
    throw new Error("Invalid write receipt");
  return value;
}
