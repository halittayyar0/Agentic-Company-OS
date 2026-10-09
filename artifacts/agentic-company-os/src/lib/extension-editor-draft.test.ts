import assert from "node:assert/strict";
import test from "node:test";
import {
  readExtensionEditor,
  writeExtensionEditor,
  clearExtensionEditor,
  readExtensionSave,
  beginExtensionSave,
  clearExtensionSave,
  classifyExtensionSave,
  prepareExtensionSave,
  type ExtensionEditorDraft,
  type DraftStore,
} from "./extension-editor-draft";

const draft: ExtensionEditorDraft = {
  version: 1,
  revision: 0,
  enabled: false,
  defaults: "{invalid editable JSON",
  manifest: {
    schemaVersion: 1,
    id: "user-source-guide",
    title: "Saved guide",
    description: "Unverified editable source notes",
    kind: "skill",
    instructions: " First line\n第二行 😀  ",
  },
};
function storage(): DraftStore {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

test("editable records preserve exact unfinished fields and invalid defaults within their recovery cap", () => {
  const store = storage();
  const unfinished = {
    ...draft,
    manifest: { ...draft.manifest, id: "user-", title: "" },
  };
  assert.equal(writeExtensionEditor(unfinished, store), true);
  assert.deepEqual(readExtensionEditor(store), {
    draft: unfinished,
    error: false,
  });
  assert.equal(
    writeExtensionEditor({ ...draft, defaults: "x".repeat(65536) }, store),
    false,
  );
  assert.deepEqual(readExtensionEditor(store).draft, unfinished);
});
test("verified stores reject no-op writes, denied storage and malformed existing records", () => {
  const refused: DraftStore = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  assert.equal(writeExtensionEditor(draft, refused), false);
  assert.equal(
    beginExtensionSave(prepareExtensionSave(draft)!, refused),
    false,
  );
  const store = storage();
  store.setItem("acos.extension-editor.v1", "bad JSON");
  assert.deepEqual(readExtensionEditor(store), { draft: null, error: true });
  assert.equal(writeExtensionEditor(draft, store), false);
  const denied: DraftStore = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
    removeItem() {
      throw Error();
    },
  };
  assert.equal(writeExtensionEditor(draft, denied), false);
  assert.equal(readExtensionSave(denied).error, true);
});
test("clearing checks the exact draft and never removes a later edit", () => {
  const store = storage();
  assert.equal(writeExtensionEditor(draft, store), true);
  const edited = { ...draft, defaults: "later" };
  assert.equal(writeExtensionEditor(edited, store), true);
  assert.equal(clearExtensionEditor(draft, store), false);
  assert.deepEqual(readExtensionEditor(store).draft, edited);
  assert.equal(clearExtensionEditor(edited, store), true);
  assert.equal(readExtensionEditor(store).draft, null);
});
test("a pending save retains the same stable ID, body and revision and cannot be overwritten", () => {
  const store = storage(),
    request = prepareExtensionSave(draft)!;
  assert.equal(beginExtensionSave(request, store), true);
  assert.deepEqual(readExtensionSave(store), { request, error: false });
  assert.equal(beginExtensionSave(request, store), true);
  const other = prepareExtensionSave({
    ...draft,
    manifest: { ...draft.manifest, id: "user-another" },
  })!;
  assert.equal(beginExtensionSave(other, store), false);
  assert.equal(clearExtensionSave(other, store), false);
  assert.deepEqual(readExtensionSave(store).request, request);
  assert.equal(clearExtensionSave(request, store), true);
});
test("save validation rejects invalid limits without truncating editable text", () => {
  const store = storage();
  const long = {
    ...draft,
    manifest: { ...draft.manifest, title: "x".repeat(300) },
  };
  assert.equal(writeExtensionEditor(long, store), true);
  assert.equal(prepareExtensionSave(long), null);
  assert.equal(readExtensionEditor(store).draft?.manifest.title.length, 300);
  assert.equal(
    prepareExtensionSave({
      ...draft,
      manifest: { ...draft.manifest, description: "" },
    }),
    null,
  );
  assert.equal(
    prepareExtensionSave({
      ...draft,
      manifest: {
        ...draft.manifest,
        kind: "skill",
        instructions: "x".repeat(8001),
      },
    }),
    null,
  );
  assert.equal(
    prepareExtensionSave({
      ...draft,
      manifest: {
        ...draft.manifest,
        kind: "skill",
        instructions: "\\".repeat(8000),
        description: "x".repeat(2000),
      },
    }),
    null,
  );
});
test("raw tool defaults and program source remain editable while only valid packages can dispatch", () => {
  const tool = {
    ...draft,
    defaults: '{"z":2,"nested":{"b":2,"a":1}}',
    manifest: {
      schemaVersion: 1 as const,
      id: "user-source-guide",
      title: "Tool",
      description: "Fixed inputs",
      kind: "tool" as const,
      tool: "calculate",
      defaults: {},
    },
  };
  const request = prepareExtensionSave(tool)!;
  assert.deepEqual(request.manifest, {
    ...tool.manifest,
    defaults: { z: 2, nested: { b: 2, a: 1 } },
  });
  assert.equal(prepareExtensionSave({ ...tool, defaults: "{bad" }), null);
  assert.equal(prepareExtensionSave({ ...tool, defaults: "[]" }), null);
  assert.equal(
    prepareExtensionSave({
      ...tool,
      manifest: { ...tool.manifest, instructions: "Unexpected kind field" },
    }),
    null,
  );
  const program = {
    ...draft,
    manifest: {
      schemaVersion: 1 as const,
      id: "user-source-guide",
      title: "Program",
      description: "Reviewed code",
      kind: "program" as const,
      code: "return input;",
      permissions: ["terminal"] as ["terminal"],
    },
  };
  const store = storage();
  assert.equal(writeExtensionEditor(program, store), true);
  assert.deepEqual(readExtensionEditor(store).draft, program);
  assert.ok(prepareExtensionSave(program));
});
test("a matching read confirms canonical current contents, never an original command receipt", () => {
  const request = prepareExtensionSave(draft)!;
  const row = {
    id: draft.manifest.id,
    revision: 1,
    enabled: false,
    manifest: { ...draft.manifest },
  };
  assert.equal(classifyExtensionSave(request, [row]), "matching");
  assert.equal(classifyExtensionSave(request, []), "missing");
  assert.equal(
    classifyExtensionSave(request, [{ ...row, revision: 0 }]),
    "invalid",
  );
  assert.equal(
    classifyExtensionSave(request, [{ ...row, revision: 2 }]),
    "changed",
  );
  assert.equal(
    classifyExtensionSave(request, [{ ...row, enabled: true }]),
    "changed",
  );
  assert.equal(
    classifyExtensionSave(request, [
      { ...row, manifest: { ...row.manifest, title: "Other" } },
    ]),
    "changed",
  );
  assert.equal(classifyExtensionSave(request, [row, row]), "invalid");
  assert.equal(classifyExtensionSave(request, { data: [row] }), "invalid");
});
test("canonical tool reconciliation ignores JSON object-key ordering and respects array values", () => {
  const tool = {
    ...draft,
    defaults: '{"nested":{"b":2,"a":1},"list":[1,2]}',
    manifest: {
      schemaVersion: 1 as const,
      id: "user-source-guide",
      title: "Tool",
      description: "Fixed inputs",
      kind: "tool" as const,
      tool: "calculate",
      defaults: {},
    },
  };
  const request = prepareExtensionSave(tool)!;
  const row = {
    id: tool.manifest.id,
    revision: 1,
    enabled: false,
    manifest: {
      ...tool.manifest,
      defaults: { list: [1, 2], nested: { a: 1, b: 2 } },
    },
  };
  assert.equal(classifyExtensionSave(request, [row]), "matching");
  assert.equal(
    classifyExtensionSave(request, [
      {
        ...row,
        manifest: {
          ...row.manifest,
          defaults: { list: [2, 1], nested: { a: 1, b: 2 } },
        },
      },
    ]),
    "changed",
  );
});

test("reconciliation accepts the actual one-hundred-extension server capacity and rejects an oversized list", () => {
  const request = prepareExtensionSave(draft)!;
  const row = {
    id: draft.manifest.id,
    revision: 1,
    enabled: false,
    manifest: draft.manifest,
  };
  const rows = Array.from({ length: 99 }, (_, i) => ({
    ...row,
    id: `user-guide-${i}`,
    manifest: { ...draft.manifest, id: `user-guide-${i}` },
  }));
  rows.push(row);
  assert.equal(classifyExtensionSave(request, rows), "matching");
  assert.equal(
    classifyExtensionSave(request, [
      ...rows,
      {
        ...row,
        id: "user-extra",
        manifest: { ...draft.manifest, id: "user-extra" },
      },
    ]),
    "invalid",
  );
});

test("a tampered pending body or denied clearing cannot lose the original submission", () => {
  const store = storage(),
    request = prepareExtensionSave(draft)!;
  assert.equal(beginExtensionSave(request, store), true);
  const refused: DraftStore = { ...store, removeItem() {} };
  assert.equal(clearExtensionSave(request, refused), false);
  assert.deepEqual(readExtensionSave(store).request, request);
  store.setItem(
    "acos.extension-save.v1",
    JSON.stringify({ ...request, enabled: true }),
  );
  assert.deepEqual(readExtensionSave(store), { request: null, error: true });
  assert.equal(beginExtensionSave(request, store), false);
});
