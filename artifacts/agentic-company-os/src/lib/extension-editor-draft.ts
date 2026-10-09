export type EditableManifest = {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
} & (
  | { kind: "skill"; instructions: string }
  | { kind: "program"; code: string; permissions: ["terminal"] }
  | { kind: "tool"; tool: string; defaults: Record<string, unknown> }
);
export type ExtensionEditorDraft = {
  version: 1;
  manifest: EditableManifest;
  revision: number;
  defaults: string;
  enabled: boolean;
};
export type ExtensionSaveRequest = {
  version: 1;
  submittedDraft: ExtensionEditorDraft;
  manifest: EditableManifest;
  expectedRevision: number;
  enabled: boolean;
};
export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const EDITOR = "acos.extension-editor.v1",
  SAVE = "acos.extension-save.v1";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= 2147483647;
function keys(value: Record<string, unknown>, expected: string[]) {
  const found = Object.keys(value);
  return (
    found.length === expected.length &&
    found.every((key) => expected.includes(key))
  );
}
function json(value: unknown, depth = 0): boolean {
  if (depth > 128) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => json(item, depth + 1));
  return (
    object(value) && Object.values(value).every((item) => json(item, depth + 1))
  );
}
function manifest(value: unknown): value is EditableManifest {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !["id", "title", "description"].every(
      (key) => typeof value[key] === "string",
    )
  )
    return false;
  const base = ["schemaVersion", "id", "title", "description", "kind"];
  if (value.kind === "skill")
    return (
      keys(value, [...base, "instructions"]) &&
      typeof value.instructions === "string"
    );
  if (value.kind === "program")
    return (
      keys(value, [...base, "code", "permissions"]) &&
      typeof value.code === "string" &&
      Array.isArray(value.permissions) &&
      value.permissions.length === 1 &&
      value.permissions[0] === "terminal"
    );
  return (
    value.kind === "tool" &&
    keys(value, [...base, "tool", "defaults"]) &&
    typeof value.tool === "string" &&
    object(value.defaults) &&
    Object.keys(value.defaults).every((key) => key.length <= 100) &&
    json(value.defaults)
  );
}
function editor(value: unknown): value is ExtensionEditorDraft {
  return (
    object(value) &&
    keys(value, ["version", "manifest", "revision", "defaults", "enabled"]) &&
    value.version === 1 &&
    manifest(value.manifest) &&
    integer(value.revision) &&
    typeof value.defaults === "string" &&
    typeof value.enabled === "boolean"
  );
}
function validPackage(value: unknown): value is EditableManifest {
  if (
    !manifest(value) ||
    !/^user-[a-z0-9][a-z0-9-]{0,59}$/u.test(value.id) ||
    value.title.length < 1 ||
    value.title.length > 120 ||
    value.description.length < 1 ||
    value.description.length > 2000
  )
    return false;
  if (
    value.kind === "skill" &&
    (value.instructions.length < 1 || value.instructions.length > 8000)
  )
    return false;
  if (
    value.kind === "program" &&
    (value.code.length < 1 || value.code.length > 8000)
  )
    return false;
  // The server remains authoritative for tool names and execution permission.
  if (
    value.kind === "tool" &&
    (value.tool.length < 1 || value.tool.length > 100)
  )
    return false;
  return JSON.stringify(value).length <= 16000;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    object(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
export function prepareExtensionSave(
  draft: ExtensionEditorDraft,
): ExtensionSaveRequest | null {
  try {
    if (
      !editor(draft) ||
      draft.revision >= 2147483647 ||
      JSON.stringify(draft).length > 65536
    )
      return null;
    const value =
      draft.manifest.kind === "tool"
        ? { ...draft.manifest, defaults: JSON.parse(draft.defaults) as unknown }
        : draft.manifest;
    if (!validPackage(value)) return null;
    return JSON.parse(
      JSON.stringify({
        version: 1,
        submittedDraft: draft,
        manifest: value,
        expectedRevision: draft.revision,
        enabled: draft.enabled,
      }),
    ) as ExtensionSaveRequest;
  } catch {
    return null;
  }
}
function save(value: unknown): value is ExtensionSaveRequest {
  if (
    !object(value) ||
    !keys(value, [
      "version",
      "submittedDraft",
      "manifest",
      "expectedRevision",
      "enabled",
    ]) ||
    value.version !== 1 ||
    !editor(value.submittedDraft) ||
    !validPackage(value.manifest) ||
    !integer(value.expectedRevision) ||
    typeof value.enabled !== "boolean"
  )
    return false;
  const prepared = prepareExtensionSave(value.submittedDraft);
  return !!prepared && canonical(prepared) === canonical(value);
}
function read<T>(
  key: string,
  cap: number,
  check: (value: unknown) => value is T,
  store: DraftStore,
): { value: T | null; error: boolean } {
  try {
    const text = store.getItem(key);
    if (text === null) return { value: null, error: false };
    if (text.length > cap) return { value: null, error: true };
    const value: unknown = JSON.parse(text);
    return check(value)
      ? { value, error: false }
      : { value: null, error: true };
  } catch {
    return { value: null, error: true };
  }
}
function write<T>(
  value: T,
  key: string,
  cap: number,
  check: (value: unknown) => value is T,
  store: DraftStore,
  immutable = false,
) {
  try {
    if (!check(value)) return false;
    const text = JSON.stringify(value);
    if (text.length > cap) return false;
    const prior = read(key, cap, check, store);
    if (prior.error) return false;
    if (immutable && prior.value)
      return canonical(prior.value) === canonical(value);
    store.setItem(key, text);
    const observed = read(key, cap, check, store);
    return (
      !observed.error &&
      !!observed.value &&
      canonical(observed.value) === canonical(value)
    );
  } catch {
    return false;
  }
}
function clear<T>(
  expected: T,
  key: string,
  cap: number,
  check: (value: unknown) => value is T,
  store: DraftStore,
) {
  try {
    const observed = read(key, cap, check, store);
    if (
      observed.error ||
      !observed.value ||
      canonical(observed.value) !== canonical(expected)
    )
      return false;
    store.removeItem(key);
    return store.getItem(key) === null;
  } catch {
    return false;
  }
}
export function readExtensionEditor(store: DraftStore) {
  const result = read(EDITOR, 65536, editor, store);
  return { draft: result.value, error: result.error };
}
export const writeExtensionEditor = (
  draft: ExtensionEditorDraft,
  store: DraftStore,
) => write(draft, EDITOR, 65536, editor, store);
export const clearExtensionEditor = (
  expected: ExtensionEditorDraft,
  store: DraftStore,
) => clear(expected, EDITOR, 65536, editor, store);
export function readExtensionSave(store: DraftStore) {
  const result = read(SAVE, 131072, save, store);
  return { request: result.value, error: result.error };
}
export const beginExtensionSave = (
  request: ExtensionSaveRequest,
  store: DraftStore,
) => write(request, SAVE, 131072, save, store, true);
export const clearExtensionSave = (
  expected: ExtensionSaveRequest,
  store: DraftStore,
) => clear(expected, SAVE, 131072, save, store);
export function classifyExtensionSave(
  request: ExtensionSaveRequest,
  rows: unknown,
): "matching" | "missing" | "changed" | "invalid" {
  try {
    if (!save(request) || !Array.isArray(rows) || rows.length > 100)
      return "invalid";
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !object(row) ||
        typeof row.id !== "string" ||
        ids.has(row.id) ||
        !integer(row.revision, 1) ||
        typeof row.enabled !== "boolean" ||
        !validPackage(row.manifest) ||
        row.manifest.id !== row.id
      )
        return "invalid";
      ids.add(row.id);
    }
    const row = rows.find((item) => item.id === request.manifest.id) as
      | { revision: number; enabled: boolean; manifest: EditableManifest }
      | undefined;
    if (!row || row.revision === request.expectedRevision) return "missing";
    return row.revision === request.expectedRevision + 1 &&
      row.enabled === request.enabled &&
      canonical(row.manifest) === canonical(request.manifest)
      ? "matching"
      : "changed";
  } catch {
    return "invalid";
  }
}
