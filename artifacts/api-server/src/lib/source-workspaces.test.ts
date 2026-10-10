import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  realpath,
  writeFile,
  mkdir,
  readFile,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const directory = await mkdtemp(
  path.join(await realpath(tmpdir()), "acos source proof "),
);
const sandboxRoot = path.join(directory, "sandboxes");
const fixtureId = "00000000-0000-0000-0000-000000000000";
const reviewLockPath = path.join(
  sandboxRoot,
  ".source-reviews",
  `${fixtureId}-${fixtureId}`,
  ".git",
  "refs",
  "heads",
  "codex",
  `source-${fixtureId}.lock`,
);
// Exercise Git's actual branch-ref lock path even on short hosted Windows roots.
const windowsPathPadding =
  process.platform === "win32"
    ? "x".repeat(Math.max(0, 260 - reviewLockPath.length))
    : "";
process.env.AGENT_SANDBOX_ROOT = sandboxRoot + windowsPathPadding;
process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
const {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  sourceChangesTable,
  codexTaskSessionsTable,
  closeDatabase,
} = await import("@workspace/db");
const { loadCompletionEvidence } =
  await import("./orchestrator/completion-evidence");
const {
  prepareSourceChange,
  inspectSourceChange,
  checkSourceChange,
  applySourceChange,
  rollbackSourceChange,
} = await import("./source-workspaces");
test.after(async () => {
  await closeDatabase();
  await rm(directory, { recursive: true, force: true });
});

test("a source change stays isolated, requires passing checks, applies only its base and rolls back by a new commit", async () => {
  await dbReady;
  const source = path.join(directory, "original source");
  await mkdir(source);
  const git = (...args: string[]) =>
    promisify(execFile)("git", ["-C", source, ...args], { windowsHide: true });
  await git("init");
  await writeFile(
    path.join(source, "answer.mjs"),
    "export const answer = 1;\n",
  );
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@localhost",
    "commit",
    "-m",
    "initial",
  );
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Source specialist",
      role: "Engineer",
      systemPrompt: "fixture",
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: false,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const request = {
    id: randomUUID(),
    agentId: agent.id,
    sourcePath: source,
    request: "Change answer to two",
  };
  const prepared = await prepareSourceChange(request);
  assert.equal(prepared.state, "draft");
  assert.ok(prepared.taskId);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, prepared.taskId));
  const delivery = async () =>
    (await loadCompletionEvidence(task)).sourceChanges[0];
  assert.equal((await prepareSourceChange(request)).id, prepared.id);
  const copy = path.join(
    process.env.AGENT_SANDBOX_ROOT!,
    `agent-${agent.id}`,
    "source-changes",
    request.id,
  );
  await writeFile(path.join(copy, "answer.mjs"), "export const answer = 2;\n");
  assert.match(await readFile(path.join(source, "answer.mjs"), "utf8"), /1/);
  const reviewed = await inspectSourceChange(request.id);
  assert.match(reviewed.diff, /answer = 2/);
  await assert.rejects(
    applySourceChange(request.id, prepared.revision),
    /SOURCE_NOT_VERIFIED/,
  );
  const failed = await checkSourceChange(request.id, prepared.revision, [
    "node",
    "--eval",
    "process.exit(1)",
  ]);
  assert.equal(failed.state, "draft");
  assert.equal((await delivery()).snapshotChecksPassed, false);
  const checked = await checkSourceChange(request.id, failed.revision, [
    "node",
    "--check",
    "{workspace}/answer.mjs",
  ]);
  assert.equal(checked.state, "verified");
  assert.equal((await delivery()).snapshotChecksPassed, true);
  assert.equal((await delivery()).candidateCommit, checked.candidateCommit);
  assert.equal((await delivery()).applicationRecorded, false);
  const applied = await applySourceChange(request.id, checked.revision);
  assert.equal(applied.state, "applied");
  assert.equal((await delivery()).applicationRecorded, true);
  assert.match(await readFile(path.join(source, "answer.mjs"), "utf8"), /2/);
  assert.equal(
    (await applySourceChange(request.id, checked.revision)).appliedCommit,
    applied.appliedCommit,
  );
  const reverted = await rollbackSourceChange(request.id, applied.revision);
  assert.equal(reverted.state, "rolled_back");
  assert.equal((await delivery()).snapshotChecksPassed, true);
  assert.equal((await delivery()).applicationRecorded, false);
  assert.match(await readFile(path.join(source, "answer.mjs"), "utf8"), /1/);
  await writeFile(path.join(source, "untracked.txt"), "operator work");
  await assert.rejects(
    prepareSourceChange({ ...request, id: randomUUID() }),
    /SOURCE_DIRTY/,
  );
});

async function fixture() {
  await dbReady;
  const source = path.join(directory, randomUUID());
  await mkdir(source);
  const git = (...args: string[]) =>
    promisify(execFile)("git", ["-C", source, ...args], { windowsHide: true });
  await git("init");
  await writeFile(
    path.join(source, "answer.mjs"),
    "export const answer = 1;\n",
  );
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@localhost",
    "commit",
    "-m",
    "initial",
  );
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: randomUUID(),
      role: "Engineer",
      systemPrompt: "fixture",
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: false,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const row = await prepareSourceChange({
    id: randomUUID(),
    agentId: agent.id,
    sourcePath: source,
    request: "Change answer",
  });
  const copy = path.join(
    process.env.AGENT_SANDBOX_ROOT!,
    `agent-${agent.id}`,
    "source-changes",
    row.id,
  );
  return { source, git, row, copy, agent };
}
test("checked snapshot excludes later agent edits and protects concurrent original edits", async () => {
  const { source, row, copy } = await fixture();
  await writeFile(path.join(copy, "answer.mjs"), "export const answer = 2;\n");
  const checked = await checkSourceChange(row.id, row.revision, [
    ["node", "--check", "{workspace}/answer.mjs"],
    ["node", "--eval", "process.exit(0)"],
  ]);
  assert.equal(checked.check?.commands?.length, 2);
  await writeFile(
    path.join(copy, "answer.mjs"),
    "export const answer = 999;\n",
  );
  await writeFile(path.join(source, "operator.txt"), "preserve me");
  await assert.rejects(
    applySourceChange(row.id, checked.revision),
    /SOURCE_DIRTY/,
  );
  assert.match(await readFile(path.join(source, "answer.mjs"), "utf8"), /1/);
  await rm(path.join(source, "operator.txt"));
  await assert.rejects(
    applySourceChange(row.id, row.revision),
    /SOURCE_REVISION_CONFLICT/,
  );
  await applySourceChange(row.id, checked.revision);
  assert.match(await readFile(path.join(source, "answer.mjs"), "utf8"), /2/);
});
test("already committed private files cannot bypass snapshot review", async () => {
  const { row, copy, source } = await fixture();
  await writeFile(path.join(copy, ".env"), "FIXTURE=true");
  await promisify(execFile)("git", ["-C", copy, "add", ".env"], {
    windowsHide: true,
  });
  await promisify(execFile)(
    "git",
    [
      "-C",
      copy,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@localhost",
      "commit",
      "-m",
      "private fixture",
    ],
    { windowsHide: true },
  );
  await assert.rejects(
    checkSourceChange(row.id, row.revision, [
      "node",
      "--eval",
      "process.exit(0)",
    ]),
    /SOURCE_PRIVATE_FILE_REJECTED/,
  );
  await assert.rejects(readFile(path.join(source, ".env")), /ENOENT/);
});
test("fresh policy downgrade blocks applying a previously verified candidate", async () => {
  const { row, copy, source } = await fixture();
  await writeFile(path.join(copy, "answer.mjs"), "export const answer = 2;\n");
  const checked = await checkSourceChange(row.id, row.revision, [
    "node",
    "--check",
    "{workspace}/answer.mjs",
  ]);
  const { readExecutionPolicy, updateExecutionPolicy } =
    await import("./execution-policy");
  const policy = await readExecutionPolicy();
  const restricted = await updateExecutionPolicy({
    mode: "read_only",
    expectedRevision: policy.revision,
  });
  try {
    await assert.rejects(
      applySourceChange(row.id, checked.revision),
      /EXECUTION_POLICY_DENIED/,
    );
  } finally {
    await updateExecutionPolicy({
      mode: "approval",
      expectedRevision: restricted.revision,
    });
  }
  assert.match(await readFile(path.join(source, "answer.mjs"), "utf8"), /1/);
});
test("an unchanged workspace cannot create a misleading applied version", async () => {
  const { row } = await fixture();
  await assert.rejects(
    checkSourceChange(row.id, row.revision, [
      "node",
      "--eval",
      "process.exit(0)",
    ]),
    /SOURCE_NO_CHANGES/,
  );
});

for (const state of ["running", "uncertain"])
  test(`source checks refuse a ${state} native session with unverified cleanup without committing or advancing the source revision`, async () => {
    const { row, copy, agent } = await fixture();
    await writeFile(
      path.join(copy, "answer.mjs"),
      "export const answer = 2;\n",
    );
    assert.ok(row.taskId);
    const head = () =>
      promisify(execFile)("git", ["-C", copy, "rev-parse", "HEAD"], {
        windowsHide: true,
      });
    const before = (await head()).stdout;
    try {
      await db.insert(codexTaskSessionsTable).values({
        taskId: row.taskId,
        agentId: agent.id,
        revision: 1,
        state,
        ownerToken: state === "running" ? randomUUID() : null,
        attemptId: randomUUID(),
        leaseOwner: randomUUID(),
        policyRevision: 1,
        registrationId: randomUUID(),
        registrationRevision: 1,
        admissionVersion: 0,
        hostId: "fixture",
        cwd: copy,
        storageDirectory: "/fixture/private",
        home: "/fixture/private/home",
        model: "fixture",
        executableDigest: "a".repeat(64),
      });
      await assert.rejects(
        checkSourceChange(row.id, row.revision, [
          "node",
          "--check",
          "{workspace}/answer.mjs",
        ]),
        /SOURCE_CODING_ACTIVE/,
      );
      const [current] = await db
        .select()
        .from(sourceChangesTable)
        .where(eq(sourceChangesTable.id, row.id));
      assert.equal(current.state, "draft");
      assert.equal(current.revision, row.revision);
      assert.equal((await head()).stdout, before);
    } finally {
      await db
        .delete(codexTaskSessionsTable)
        .where(eq(codexTaskSessionsTable.taskId, row.taskId));
    }
    assert.equal(
      (
        await checkSourceChange(row.id, row.revision, [
          "node",
          "--check",
          "{workspace}/answer.mjs",
        ])
      ).state,
      "verified",
    );
  });
