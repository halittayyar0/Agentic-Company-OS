import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createCodexActionTracker } from "./codex-action-scope";

async function setup(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acos-action-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const privateHome = path.join(root, "private");
  await Promise.all([mkdir(workspace), mkdir(privateHome)]);
  const tracker = createCodexActionTracker({
    workspace,
    deniedPaths: [privateHome],
    secrets: ["fixture-private-credential"],
  });
  const scope = { threadId: "thread_fixture", turnId: "turn_fixture" };
  const changes = [
    {
      path: path.join(workspace, "new.txt"),
      kind: { type: "add" },
      diff: "Useful result\n",
    },
  ];
  const start = (item: Record<string, unknown>) =>
    tracker.observe({
      method: "item/started",
      params: { ...scope, startedAtMs: 100, item },
    });
  const patch = () =>
    start({
      type: "fileChange",
      id: "item_patch",
      changes,
      status: "inProgress",
    });
  const request = () => ({
    id: "approval_fixture",
    method: "item/fileChange/requestApproval",
    params: { ...scope, itemId: "item_patch", startedAtMs: 101 },
  });
  return {
    root,
    workspace,
    privateHome,
    tracker,
    scope,
    changes,
    start,
    patch,
    request,
  };
}

test("native patch identity and byte-exact preview are captured before caller mutation", async (t) => {
  const f = await setup(t);
  f.patch();
  f.changes[0].diff = "Mutated caller content\n";
  const review = f.tracker.review(f.request());
  assert.equal(review.action.effect.type, "fileChange");
  if (review.action.effect.type === "fileChange")
    assert.equal(review.action.effect.changes[0].diff, "Useful result\n");
  assert.match(review.action.digest, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(review.action));
  assert.equal(review.action.startedAtMs, 100);
  f.tracker.assertReview(review.action);
});

test("native patch revisions cancel an open review and permanently fence its digest", async (t) => {
  const f = await setup(t);
  f.patch();
  const review = f.tracker.review(f.request());
  f.tracker.observe({
    method: "item/fileChange/patchUpdated",
    params: {
      ...f.scope,
      itemId: "item_patch",
      changes: [{ ...f.changes[0], diff: "Changed\n" }],
    },
  });
  assert.equal(review.signal.aborted, true);
  assert.throws(() => f.tracker.assertReview(review.action), {
    kind: "protocol",
  });
  assert.throws(() => f.tracker.review(f.request()), { kind: "protocol" });
});

test("command approval must match the native command and cwd, not friendly commandActions", async (t) => {
  const f = await setup(t);
  f.start({
    type: "commandExecution",
    id: "item_command",
    status: "inProgress",
    command: "node --version",
    cwd: f.workspace,
    pluginId: null,
    scriptPath: null,
    source: "agent",
  });
  const request = {
    id: 4,
    method: "item/commandExecution/requestApproval",
    params: {
      ...f.scope,
      itemId: "item_command",
      startedAtMs: 101,
      command: "node --version",
      cwd: f.workspace,
      environmentId: null,
    },
  };
  assert.throws(
    () =>
      f.tracker.review({
        ...request,
        params: {
          ...request.params,
          command: "delete everything",
          commandActions: [{ type: "read", path: "README.md" }],
        },
      }),
    { kind: "protocol" },
  );
  assert.throws(
    () =>
      f.tracker.review({
        ...request,
        params: { ...request.params, kind: "writeStdin" },
      }),
    { kind: "unsupported_capability" },
  );
  assert.throws(
    () =>
      f.tracker.review({
        ...request,
        params: { ...request.params, approvalId: "opaque-subcommand" },
      }),
    { kind: "unsupported_capability" },
  );
  const review = f.tracker.review(request);
  assert.deepEqual(review.action.effect, {
    type: "commandExecution",
    command: "node --version",
    cwd: f.workspace,
  });
});

test("file targets and move destinations cannot escape the backend workspace or traverse a junction", async (t) => {
  const f = await setup(t);
  const linked = path.join(f.workspace, "linked");
  await symlink(
    f.privateHome,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const target of [
    path.join(f.privateHome, "secret.txt"),
    path.join(linked, "future", "secret.txt"),
    "../secret.txt",
    f.workspace,
  ]) {
    assert.throws(
      () =>
        f.start({
          type: "fileChange",
          id: "item_bad",
          status: "inProgress",
          changes: [{ ...f.changes[0], path: target }],
        }),
      { kind: "unsupported_capability" },
    );
  }
  assert.throws(
    () =>
      f.start({
        type: "fileChange",
        id: "item_move",
        status: "inProgress",
        changes: [
          {
            ...f.changes[0],
            kind: { type: "update", move_path: path.join(linked, "moved.txt") },
          },
        ],
      }),
    { kind: "unsupported_capability" },
  );
});

test("a junction introduced after review fails the final synchronous approval fence", async (t) => {
  const f = await setup(t);
  const directory = path.join(f.workspace, "future");
  f.changes[0].path = path.join(directory, "result.txt");
  f.patch();
  const review = f.tracker.review(f.request());
  await symlink(
    f.privateHome,
    directory,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => f.tracker.assertReview(review.action), {
    kind: "unsupported_capability",
  });
});

test("secretful, control-spoofed and oversized previews are refused instead of silently masked or truncated", async (t) => {
  const f = await setup(t);
  for (const diff of [
    "fixture-private-credential",
    "API_KEY=not-for-review",
    "Bearer private-value",
    "content\u202eexe",
    "x".repeat(256 * 1024 + 1),
  ]) {
    assert.throws(
      () =>
        f.start({
          type: "fileChange",
          id: "item_bad",
          status: "inProgress",
          changes: [{ ...f.changes[0], diff }],
        }),
      { kind: "unsupported_capability" },
    );
  }
});

test("terminal native receipts match exact reviewed scope and never claim deliverable verification", async (t) => {
  const f = await setup(t);
  f.patch();
  const review = f.tracker.review(f.request());
  f.tracker.recordDecision(review.action, "accept");
  const receipt = f.tracker.observe({
    method: "item/completed",
    params: {
      ...f.scope,
      completedAtMs: 105,
      item: {
        type: "fileChange",
        id: "item_patch",
        changes: f.changes,
        status: "completed",
      },
    },
  });
  assert.equal(receipt?.actionDigest, review.action.digest);
  assert.equal(receipt?.status, "completed");
  assert.equal(receipt?.proofScope, "codex_item");
  assert.equal(receipt?.decision, "accept");
  assert.equal(JSON.stringify(receipt).includes("Useful result"), false);
  assert.throws(() => f.tracker.assertReview(review.action), {
    kind: "protocol",
  });
  f.tracker.assertTerminal();
});

test("a command failure retains real exit status and a mismatched terminal patch is rejected", async (t) => {
  const f = await setup(t);
  const item = {
    type: "commandExecution",
    id: "item_command",
    status: "inProgress",
    command: "node --version",
    cwd: f.workspace,
    pluginId: null,
    scriptPath: null,
    source: "agent",
  };
  f.start(item);
  const receipt = f.tracker.observe({
    method: "item/completed",
    params: {
      ...f.scope,
      completedAtMs: 105,
      item: { ...item, status: "failed", exitCode: 2 },
    },
  });
  assert.equal(receipt?.exitCode, 2);
  assert.equal(receipt?.status, "failed");
  f.patch();
  assert.throws(
    () =>
      f.tracker.observe({
        method: "item/completed",
        params: {
          ...f.scope,
          completedAtMs: 105,
          item: {
            type: "fileChange",
            id: "item_patch",
            changes: [{ ...f.changes[0], diff: "Different\n" }],
            status: "completed",
          },
        },
      }),
    { kind: "protocol" },
  );
  assert.throws(() => f.tracker.assertTerminal(), { kind: "protocol" });
});

test("unknown, reused, wrong-thread and overlapping patch targets fail closed", async (t) => {
  const f = await setup(t);
  assert.throws(() => f.tracker.review(f.request()), { kind: "protocol" });
  assert.throws(
    () =>
      f.start({
        type: "fileChange",
        id: "duplicate_targets",
        status: "inProgress",
        changes: [f.changes[0], f.changes[0]],
      }),
    { kind: "protocol" },
  );
  f.patch();
  assert.throws(() => f.patch(), { kind: "protocol" });
  assert.throws(
    () =>
      f.tracker.review({
        ...f.request(),
        params: { ...f.request().params, turnId: "other_turn" },
      }),
    { kind: "protocol" },
  );
});

test("native choices restrict one-time decisions and raw explanations never cross the review port", async (t) => {
  const f = await setup(t);
  f.start({
    type: "commandExecution",
    id: "item_command",
    status: "inProgress",
    command: "node --version",
    cwd: f.workspace,
    source: "agent",
  });
  const review = f.tracker.review({
    id: 5,
    method: "item/commandExecution/requestApproval",
    params: {
      ...f.scope,
      itemId: "item_command",
      startedAtMs: 101,
      command: "node --version",
      cwd: f.workspace,
      availableDecisions: ["decline", "cancel"],
      reason: "fixture-private-credential",
      commandActions: [{ path: "fixture-private-credential" }],
    },
  });
  assert.equal(
    JSON.stringify(review.request).includes("fixture-private-credential"),
    false,
  );
  assert.throws(() => f.tracker.recordDecision(review.action, "accept"), {
    kind: "unsupported_capability",
  });
  f.tracker.recordDecision(review.action, "decline");
});

test("Windows aliases and alternate streams cannot change an unreviewed target", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows filesystem aliases");
    return;
  }
  const f = await setup(t);
  for (const name of [
    "result.txt:private",
    "result.txt.",
    "result.txt ",
    "CON",
    "NUL.txt",
    "lpt1.txt",
    "COM1",
  ]) {
    assert.throws(
      () =>
        f.start({
          type: "fileChange",
          id: "item_bad",
          status: "inProgress",
          changes: [{ ...f.changes[0], path: path.join(f.workspace, name) }],
        }),
      { kind: "unsupported_capability" },
    );
  }
});

test("a command already masked by Codex cannot stand in for an unseen executable scope", async (t) => {
  const f = await setup(t);
  assert.throws(
    () =>
      f.start({
        type: "commandExecution",
        id: "item_masked",
        status: "inProgress",
        command: "echo '[REDACTED_SECRET]'",
        cwd: f.workspace,
        source: "agent",
      }),
    { kind: "unsupported_capability" },
  );
});

test("a reviewed item cannot claim completed execution before a native one-time decision", async (t) => {
  const f = await setup(t);
  const item = {
    type: "commandExecution",
    id: "item_command",
    status: "inProgress",
    command: "node --version",
    cwd: f.workspace,
    source: "agent",
  };
  f.start(item);
  f.tracker.review({
    id: 5,
    method: "item/commandExecution/requestApproval",
    params: {
      ...f.scope,
      itemId: item.id,
      startedAtMs: 101,
      command: item.command,
      cwd: item.cwd,
    },
  });
  assert.throws(
    () =>
      f.tracker.observe({
        method: "item/completed",
        params: {
          ...f.scope,
          completedAtMs: 105,
          item: { ...item, status: "completed", exitCode: 0 },
        },
      }),
    { kind: "protocol" },
  );
});
