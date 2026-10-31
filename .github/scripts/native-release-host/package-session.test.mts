import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PackageSession, assertSafePublicText } from "./package-session.mts";
import { newModelPreparationTrace, recordHostAdmission } from "./runtime.mts";

test("model preparation diagnostics retain only safe numeric host facts and never import probe text", () => {
  const trace = newModelPreparationTrace();
  recordHostAdmission(trace, {
    freeVirtualKiB: 6291456,
    cFreeBytes: 2147483648,
    fixtureFreeBytes: 8589934592,
    privatePath: "C:\\private-fixture",
    secret: "synthetic-unit-secret-value",
  });
  assert.deepEqual(trace.hostAdmission, {
    freeVirtualKiB: 6291456,
    cFreeBytes: 2147483648,
    fixtureFreeBytes: 8589934592,
  });
  assertSafePublicText(JSON.stringify(trace), ["synthetic-unit-secret-value"]);
  recordHostAdmission(trace, {
    freeVirtualKiB: NaN,
    cFreeBytes: "C:\\private-fixture",
    fixtureFreeBytes: 0,
  });
  assert.deepEqual(trace.hostAdmission, {
    freeVirtualKiB: null,
    cFreeBytes: null,
    fixtureFreeBytes: 0,
  });
  assert.equal(trace.pullRequests, 0);
  assert.equal(trace.daemonCreated, false);
});

test("public result proof rejects credential literals and host paths before exporting an image or receipt", () => {
  const secret = "synthetic-unit-secret-value";
  assert.doesNotThrow(() =>
    assertSafePublicText("Saved delivery: 73 EUR. Local workspace.", [secret]),
  );
  for (const text of [
    secret,
    "C:\\Users\\synthetic\\private",
    "D:/a/_temp/private",
    "\\\\example\\private",
    "Bearer synthetic-credential",
    "operator_auth_token",
  ])
    assert.throws(() => assertSafePublicText(text, [secret]));
});

test("owned package IPC rejects an invalid ready frame and still joins graceful cleanup", async () => {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, "acos-package-ipc-unit-"));
  try {
    await mkdir(path.join(root, "scripts/src/setup"), { recursive: true });
    // Fake IPC lifecycle only: no packaged runtime, database, account, model or
    // installer executes. Exercise the real event/error ownership code.
    await writeFile(
      path.join(root, "scripts/src/setup/bootstrap.mjs"),
      "export async function launchSetup(){return {session:{url:7,async close(){}},executor:{async stopNative(){}}};}\n",
      { flag: "wx" },
    );
    const session = new PackageSession(root, root, root);
    session.node = () => process.execPath;
    await assert.rejects(session.start(), /owned_package_invalid_ready_frame/);
    await session.stop();
    assert.equal(session.child, undefined);
  } finally {
    const owned = await realpath(root);
    assert.equal(path.dirname(owned), parent);
    assert.ok(path.basename(owned).startsWith("acos-package-ipc-unit-"));
    await rm(owned, { recursive: true });
  }
});
