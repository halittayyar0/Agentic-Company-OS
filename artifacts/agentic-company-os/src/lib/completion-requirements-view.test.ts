import assert from "node:assert/strict";
import test from "node:test";
import {
  completionSnapshotView,
  completionCatalogView,
} from "./completion-requirements-view";
import { canonicalCompletionRequirements } from "./completion-requirements-input";
import { parseCompletionRequirements } from "../../../../lib/db/src/completion-requirements";
import { loadCompletionRequirementsCopy } from "./completion-requirements-copy";
import { LOCALES } from "./i18n";

test("completion snapshots reject foreign tasks, raw payloads, duplicates and unknown execution evidence", () => {
  const value = {
    source: "persisted_current_cycle",
    taskId: 41,
    cycleNumber: 2,
    taskStatus: "in_progress",
    observedAt: "2026-10-11T01:00:00Z",
    requirements: [
      {
        kind: "tool_succeeded",
        tool: "calculate",
        satisfied: false,
        available: true,
      },
    ],
  };
  assert.deepEqual(completionSnapshotView(value, 41), value);
  for (const bad of [
    { ...value, taskId: 42 },
    { ...value, raw: "PRIVATE" },
    { ...value, cycleNumber: -1 },
    { ...value, observedAt: "invalid" },
    { ...value, requirements: [...value.requirements, ...value.requirements] },
    {
      ...value,
      requirements: [{ ...value.requirements[0], satisfied: "unknown" }],
    },
    {
      ...value,
      requirements: [{ ...value.requirements[0], result: "PRIVATE" }],
    },
    {
      ...value,
      requirements: [{ ...value.requirements[0], tool: "vm_codex_task" }],
    },
  ])
    assert.equal(completionSnapshotView(bad, 41), null);
});

test("completion catalogs never convert descriptions, schemas, duplicates or lifecycle tools into choices", () => {
  assert.deepEqual(
    completionCatalogView({
      ownerAgentId: 2,
      tools: ["calculate", "vm_read_file"],
    }),
    { ownerAgentId: 2, tools: ["calculate", "vm_read_file"] },
  );
  for (const tools of [
    ["complete_task"],
    ["calculate", "calculate"],
    [{ name: "calculate" }],
    ["/private/path"],
    ["vm_codex_task"],
  ])
    assert.equal(completionCatalogView({ ownerAgentId: 2, tools }), null);
  assert.equal(
    completionCatalogView({
      ownerAgentId: 2,
      tools: ["calculate"],
      permissions: ["all"],
    }),
    null,
  );
});

test("browser data validation preserves the server's bounded canonical operation contract", () => {
  for (const tool of [
    "calculate",
    "read_skill",
    "complete_task",
    "request_approval",
    "request_user_input",
    "delegate_task",
    "create_sub_agent",
    "update_task_progress",
    "load_tools",
    "list_skills",
    "list_extensions",
    "log_note",
    "post_company_message",
    "vm_codex_task",
    "Browser_X",
    "x".repeat(81),
    "bad/name",
  ]) {
    const input = [{ kind: "tool_succeeded", tool }];
    try {
      const expected = parseCompletionRequirements(input);
      assert.deepEqual(canonicalCompletionRequirements(input), expected);
    } catch {
      assert.throws(() => canonicalCompletionRequirements(input));
    }
  }
  const input = [
    { kind: "tool_succeeded", tool: "vm_read_file" },
    { kind: "tool_succeeded", tool: "calculate" },
  ];
  assert.deepEqual(
    canonicalCompletionRequirements(input),
    parseCompletionRequirements(input),
  );
});

test("all seven authored condition languages include matching operations and explicit permission and quality limits", async () => {
  const baseline = await loadCompletionRequirementsCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadCompletionRequirementsCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(baseline).sort());
    assert.deepEqual(
      Object.keys(copy.labels).sort(),
      Object.keys(baseline.labels).sort(),
    );
    for (const value of [
      ...Object.values(copy).filter((value) => typeof value === "string"),
      ...Object.values(copy.labels),
    ])
      assert.ok(value.trim().length > 0);
    if (locale !== "en") {
      assert.notEqual(copy.title, baseline.title);
      assert.notEqual(copy.sourceHelp, baseline.sourceHelp);
      assert.notEqual(copy.permissionHelp, baseline.permissionHelp);
      assert.notEqual(copy.unavailableActive, baseline.unavailableActive);
    }
  }
});
