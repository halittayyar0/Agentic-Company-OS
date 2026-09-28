import assert from "node:assert/strict";
import test from "node:test";
import { dbReady, closeDatabase } from "@workspace/db";
import {
  saveExtension,
  discoverExtensions,
  executeInstalledTool,
} from "./extension-store";
import { resolveLocalProgram } from "./local-program";
test.before(() => dbReady);
test.after(() => closeDatabase());
const manifest = {
  schemaVersion: 1,
  id: "user-invoice",
  kind: "program",
  title: "Invoice total",
  description: "Multiply input.units by input.price",
  code: "return {total: input.units * input.price};",
  permissions: ["terminal"],
};
test("local programs are revision-bound and cannot run through the read-only preset dispatcher", async () => {
  await saveExtension({ manifest, enabled: true, expectedRevision: 0 });
  const command = 'extension user-invoice@1 {"units":3,"price":8}';
  const program = await resolveLocalProgram(command);
  assert.ok(program);
  assert.equal(program.argv[0], "node");
  assert.equal(program.argv.at(-1), '{"units":3,"price":8}');
  await assert.rejects(
    executeInstalledTool(manifest.id, { units: 3, price: 8 }, "en"),
    /NOT_EXECUTABLE/,
  );
  const catalog = await discoverExtensions();
  assert.ok(catalog.items.some((row) => row.id === manifest.id));
  await saveExtension({ manifest, enabled: false, expectedRevision: 1 });
  await assert.rejects(program.revalidate(), /DISABLED|REVISION/);
  await assert.rejects(resolveLocalProgram(command), /DISABLED|REVISION/);
});
test("program registration rejects undeclared authority and caller-controlled executables", async () => {
  for (const patch of [
    { permissions: [] },
    { permissions: ["sudo"] },
    { executable: "anything" },
    { code: "x".repeat(8001) },
  ])
    await assert.rejects(
      saveExtension({
        manifest: { ...manifest, ...patch },
        enabled: true,
        expectedRevision: 2,
      }),
    );
  assert.equal(await resolveLocalProgram("echo ordinary"), null);
  await assert.rejects(
    resolveLocalProgram("extension user-invoice@1 []"),
    /INPUT/,
  );
});

test("a user-installed program executes through a real approved-action receipt exactly once", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { default: path } = await import("node:path"),
    { randomUUID } = await import("node:crypto");
  const root = await mkdtemp(path.join(tmpdir(), "acos-program-proof-"));
  const previousRoot = process.env.AGENT_SANDBOX_ROOT,
    previousGate = process.env.ALLOW_AGENT_PROCESS_EXEC;
  process.env.AGENT_SANDBOX_ROOT = root;
  process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
  process.env.TEST_PROGRAM_SECRET = "must-not-reach-program";
  try {
    const {
      db,
      agentsTable,
      tasksTable,
      approvalRequestsTable,
      runtimeInstancesTable,
      operationReceiptsTable,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { executeTool, executeApprovedAction } =
      await import("../orchestrator/execute-tool");
    const { canonicalArgumentHash } =
      await import("../orchestrator/operation-receipts");
    const { readRuntimeOperationsConfig } =
      await import("../runtime-operations-config");
    const { specialistPermissionsPreset } =
      await import("../orchestrator/permission-presets");
    const { readTextFile } = await import("../vm/sandbox");
    const program = {
      ...manifest,
      id: "user-proof",
      code: "require('node:fs').appendFileSync('program-runs.txt','1'); return {total:input.units*input.price,secret:process.env.TEST_PROGRAM_SECRET??null};",
    };
    await saveExtension({
      manifest: program,
      enabled: true,
      expectedRevision: 0,
    });
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: "Program proof",
        role: "Engineer",
        systemPrompt: "Fixture",
        createdByUser: true,
        permissions: { ...specialistPermissionsPreset, canUseTerminal: true },
      })
      .returning();
    const args = { command: 'extension user-proof@1 {"units":3,"price":8}' };
    const denied = await executeTool(
      { agent, taskId: null, locale: "en" },
      "vm_run_command",
      JSON.stringify(args),
    );
    assert.equal(denied.toolOutcome, "rejected");
    assert.match(denied.content, /approval|permission/i);
    const runtimeInstanceId = `program-${randomUUID()}`;
    await db.insert(runtimeInstancesTable).values({
      id: runtimeInstanceId,
      role: "worker",
      state: "healthy",
      hostname: "fixture",
      processId: 1234,
      buildVersion: "test",
      schedulerEnabled: true,
      lastHeartbeatAt: new Date(),
    });
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: "Program proof",
        brief: "Fixture",
        ownerAgentId: agent.id,
        status: "awaiting_approval",
        createdByUser: true,
      })
      .returning();
    const [approval] = await db
      .insert(approvalRequestsTable)
      .values({
        taskId: task.id,
        agentId: agent.id,
        category: "other",
        title: "Exact local program",
        description: "Fixture",
        status: "approved",
        resolvedAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
        scope: {
          toolName: "vm_run_command",
          argsHash: canonicalArgumentHash(args),
        },
        actionPayload: {
          toolName: "vm_run_command",
          args,
          taskDisposition: "complete",
        },
      })
      .returning();
    const config = readRuntimeOperationsConfig(),
      dependencies = { runtimeInstanceId, locale: "en" as const };
    const result = await executeApprovedAction(
      approval.id,
      config,
      dependencies,
    );
    assert.equal(result.claimed, true);
    assert.match(result.output ?? "", /"total":24/);
    assert.match(result.output ?? "", /"secret":null/);
    assert.equal(
      (await readTextFile(agent.id, "program-runs.txt")).content,
      "1",
    );
    const replay = await executeApprovedAction(
      approval.id,
      config,
      dependencies,
    );
    assert.equal(replay.claimed, false);
    assert.equal(
      (await readTextFile(agent.id, "program-runs.txt")).content,
      "1",
    );
    const receipts = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.approvalId, approval.id));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].state, "succeeded");
  } finally {
    if (previousRoot === undefined) delete process.env.AGENT_SANDBOX_ROOT;
    else process.env.AGENT_SANDBOX_ROOT = previousRoot;
    if (previousGate === undefined) delete process.env.ALLOW_AGENT_PROCESS_EXEC;
    else process.env.ALLOW_AGENT_PROCESS_EXEC = previousGate;
    delete process.env.TEST_PROGRAM_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});
