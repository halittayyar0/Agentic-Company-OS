import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, dbReady } from "@workspace/db";
import { db, agentsTable } from "@workspace/db";
import { executeTool } from "./orchestrator/execute-tool";
import { getToolsForAgent } from "./orchestrator/tools";
import {
  readExecutionPolicy,
  updateExecutionPolicy,
  assertToolPolicy,
  withToolPolicy,
} from "./execution-policy";

test.after(() => closeDatabase());
test.before(() => dbReady);

test("operator policy persists, rejects malformed settings and uses revision conflicts", async () => {
  const initial = await readExecutionPolicy();
  assert.equal(initial.mode, "approval");
  const updated = await updateExecutionPolicy({
    mode: "read_only",
    expectedRevision: initial.revision,
  });
  assert.equal(updated.mode, "read_only");
  assert.equal((await readExecutionPolicy()).revision, initial.revision + 1);
  await assert.rejects(
    updateExecutionPolicy({
      mode: "full_access",
      expectedRevision: initial.revision,
    }),
    /revision/u,
  );
  await assert.rejects(
    updateExecutionPolicy({
      mode: "full_access",
      expectedRevision: updated.revision,
      actor: "agent",
    }),
    /Unrecognized/u,
  );
  await assert.rejects(
    updateExecutionPolicy({
      mode: "custom",
      expectedRevision: updated.revision,
    }),
    /custom/u,
  );
});

test("live downgrade blocks later effects and independent async tasks retain their own tool scope", async () => {
  let policy = await readExecutionPolicy();
  policy = await updateExecutionPolicy({
    mode: "full_access",
    expectedRevision: policy.revision,
  });
  await withToolPolicy("vm_write_file", async () => {
    await assertToolPolicy();
    await updateExecutionPolicy({
      mode: "read_only",
      expectedRevision: policy.revision,
    });
    await assert.rejects(assertToolPolicy(), /EXECUTION_POLICY_DENIED/u);
  });
  await Promise.all([
    withToolPolicy("vm_read_file", async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await assertToolPolicy();
    }),
    assert.rejects(
      withToolPolicy("vm_run_command", async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await assertToolPolicy();
      }),
      /EXECUTION_POLICY_DENIED/u,
    ),
  ]);
});

test("custom grants only selected capabilities and unknown tools never gain authority", async () => {
  const policy = await readExecutionPolicy();
  await updateExecutionPolicy({
    mode: "custom",
    expectedRevision: policy.revision,
    custom: {
      files: true,
      terminal: false,
      browser: false,
      delegation: false,
      sudo: false,
    },
  });
  await withToolPolicy("vm_write_file", () => assertToolPolicy());
  await assert.rejects(
    withToolPolicy("browser_open", () => assertToolPolicy()),
    /EXECUTION_POLICY_DENIED/u,
  );
  await assert.rejects(
    withToolPolicy("unknown_plugin", () => assertToolPolicy()),
    /EXECUTION_POLICY_DENIED/u,
  );
});

test("read-only policy filters model tools and independently blocks direct dispatch", async () => {
  const current = await readExecutionPolicy();
  await updateExecutionPolicy({
    mode: "read_only",
    expectedRevision: current.revision,
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Policy test",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const tools = await getToolsForAgent(agent, false);
  assert.ok(
    !tools.some(
      (tool) =>
        tool.type === "function" && tool.function.name === "vm_write_file",
    ),
  );
  const result = await executeTool(
    { agent, taskId: null, locale: "en" },
    "vm_write_file",
    JSON.stringify({ path: "blocked.txt", content: "must not write" }),
  );
  assert.equal(result.toolOutcome, "rejected");
  assert.match(result.content, /access mode/u);
});
