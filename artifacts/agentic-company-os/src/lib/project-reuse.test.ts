import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareProjectText,
  preparePersonalGuide,
  readPersonalGuidePreparation,
  consumePersonalGuidePreparation,
  preparePersonalGuideProject,
} from "./project-reuse";
const project = {
  id: 101,
  parentTaskId: null,
  title: "  分析 — تحليل  ",
  brief: " First line\n\nSecond line 😀  ",
  status: "completed",
  updatedAt: "2026-10-09T06:00:00.000Z",
  ownerAgentId: 1,
  resultSummary: "DO NOT COPY OUTPUT",
  autonomyMode: "continuous",
  cadenceSeconds: 60,
  permissions: ["terminal"],
  provider: "old-provider",
  requestId: "old-uuid",
};
test("project reuse copies exact saved root text and narrow attribution only", () => {
  assert.deepEqual(prepareProjectText(project), {
    title: project.title,
    brief: project.brief,
    source: {
      kind: "project",
      id: 101,
      status: "completed",
      updatedAt: project.updatedAt,
    },
  });
  for (const change of [
    { parentTaskId: 3 },
    { parentTaskId: undefined },
    { id: 0 },
    { brief: " " },
    { title: "x".repeat(301) },
    { brief: "x".repeat(8001) },
    { updatedAt: "2026-02-30T00:00:00Z" },
  ])
    assert.equal(prepareProjectText({ ...project, ...change }), null);
});
test("guide preparation keeps a long editable title and the supplied stable ID", () => {
  const manifest = preparePersonalGuide(
    { ...project, title: "x".repeat(300) },
    "user-stable-guide",
    "From saved project101",
  );
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    id: "user-stable-guide",
    kind: "skill",
    title: "x".repeat(300),
    description: "From saved project101",
    instructions: project.brief,
  });
  assert.equal(preparePersonalGuide(project, "builtin-id", "Source"), null);
  assert.equal(
    preparePersonalGuide(project, "user-good", "x".repeat(2001)),
    null,
  );
});
test("incoming guide seeds are bounded text guides and carry no execution authority", () => {
  const seed = {
    manifest: preparePersonalGuide(project, "user-stable-guide", "Source"),
    source: prepareProjectText(project)!.source,
  };
  assert.deepEqual(
    readPersonalGuidePreparation({ acosGuideDraft: seed }),
    seed,
  );
  for (const invalid of [
    { ...seed, permissions: ["terminal"] },
    { ...seed, source: { ...seed.source, ownerAgentId: 1 } },
    { ...seed, manifest: { ...seed.manifest, kind: "program", code: "run" } },
    { ...seed, manifest: { ...seed.manifest, instructions: "x".repeat(8001) } },
  ])
    assert.equal(
      readPersonalGuidePreparation({ acosGuideDraft: invalid }),
      null,
    );
});
test("a guide seed is consumed only after the matching history state really changes", () => {
  const seed = readPersonalGuidePreparation({
    acosGuideDraft: {
      manifest: preparePersonalGuide(project, "user-stable-guide", "Source"),
      source: prepareProjectText(project)!.source,
    },
  })!;
  const history = {
    state: { acosGuideDraft: seed, sibling: "keep" } as Record<string, unknown>,
    replaceState(value: Record<string, unknown>) {
      this.state = value;
    },
  };
  assert.equal(
    consumePersonalGuidePreparation(
      { ...seed, manifest: { ...seed.manifest, id: "user-other" } },
      history,
    ),
    false,
  );
  assert.equal(
    consumePersonalGuidePreparation(seed, {
      state: history.state,
      replaceState() {},
    }),
    false,
  );
  assert.equal(consumePersonalGuidePreparation(seed, history), true);
  assert.deepEqual(history.state, { sibling: "keep" });
});
test("disabled personal text guides can prepare text without enabling tools or replaying execution", () => {
  const manifest = preparePersonalGuide(
    project,
    "user-stable-guide",
    "Source",
  )!;
  assert.deepEqual(
    preparePersonalGuideProject({
      id: manifest.id,
      manifest,
      revision: 2,
      enabled: false,
    }),
    {
      title: manifest.title,
      brief: manifest.instructions,
      source: { kind: "guide", id: manifest.id, revision: 2, enabled: false },
    },
  );
  assert.equal(
    preparePersonalGuideProject({
      id: "user-other",
      manifest,
      revision: 2,
      enabled: false,
    }),
    null,
  );
  assert.equal(
    preparePersonalGuideProject({
      id: manifest.id,
      manifest: { ...manifest, kind: "tool", tool: "calculate", defaults: {} },
      revision: 2,
      enabled: true,
    }),
    null,
  );
});
