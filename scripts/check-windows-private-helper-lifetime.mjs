/** Real Windows creation/death conformance. No application, model or user data. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

assert.equal(
  process.platform,
  "win32",
  "This conformance requires actual Windows",
);
assert.equal(process.arch, "x64");
assert.equal(
  process.argv.length,
  4,
  "Provide a build directory and fresh report file",
);
const directory = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const build = JSON.parse(
  await readFile(path.join(directory, "build.json"), "utf8"),
);
const helper = path.join(directory, "windows-private-helper.exe");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(
  build.sourceSha256,
  sha(
    await readFile(
      new URL(
        "../lib/ai-server/native/windows-private-helper.c",
        import.meta.url,
      ),
    ),
  ),
);
assert.equal(build.executableSha256, sha(await readFile(helper)));
const execute = promisify(execFile);
const base = await mkdtemp(
  path.join(tmpdir(), "acos-native-checker-lifetime-"),
);
assert.ok(
  path.isAbsolute(base) &&
    path.basename(base).startsWith("acos-native-checker-lifetime-"),
);
const owned = [
  "çalışma 私人 vault",
  "no-ack",
  "killed",
  "populated",
  "replacement",
  "moved",
].map((name) => path.join(base, name));
const environment = (target) => ({
  ACOS_PRIVATE_STORAGE_TARGET: target,
  ACOS_PRIVATE_STORAGE_EXCLUSIVE: "1",
});
const checks = [];
const record = (name) => {
  checks.push(name);
  console.log(JSON.stringify({ check: name, passed: true }));
};
const missing = async (target) =>
  assert.rejects(lstat(target), { code: "ENOENT" });
const initialize = async (target, ack = true) => {
  const pending = execute(helper, ["--initialize-directory"], {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 16_384,
    env: environment(target),
  });
  pending.child.stdin.on("error", () => {});
  pending.child.stdin.end(ack ? "COMMIT\n" : "");
  return pending;
};

async function terminateBeforeAck(target, beforeKill = async () => {}) {
  const child = spawn(helper, ["--initialize-directory"], {
    windowsHide: true,
    env: environment(target),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let receiptSeen = false;
  let text = "";
  let rejectReceipt;
  let resolveReceipt;
  const receipt = new Promise((resolve, reject) => {
    resolveReceipt = resolve;
    rejectReceipt = reject;
  });
  const timer = setTimeout(() => {
    child.kill();
    rejectReceipt(new Error("bounded creation receipt missing"));
  }, 15_000);
  const closed = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      rejectReceipt(error);
      reject(error);
    });
    child.once("close", (code) => {
      if (!receiptSeen)
        rejectReceipt(new Error("child exited before creation receipt"));
      resolve(code);
    });
  });
  child.stderr.on("data", (chunk) => {
    text += chunk.toString("utf8");
    if (text.length > 16_384) {
      child.kill();
      rejectReceipt(new Error("bounded receipt overflow"));
      return;
    }
    if (
      !receiptSeen &&
      text.includes("ACOS_PRIVATE_STORAGE_CREATED ") &&
      text.endsWith("\n")
    ) {
      receiptSeen = true;
      resolveReceipt();
    }
  });
  child.stdout.resume();
  try {
    await receipt;
    await beforeKill();
  } finally {
    child.kill();
    try {
      await closed;
    } finally {
      clearTimeout(timer);
      child.stdin.destroy();
    }
  }
}

try {
  const good = await initialize(owned[0]);
  const result = JSON.parse(good.stdout);
  const stat = await lstat(owned[0], { bigint: true });
  assert.equal(result.protocol, 1);
  assert.equal(result.created, true);
  assert.equal(result.device, stat.dev.toString());
  assert.equal(result.inode, stat.ino.toString());
  assert.equal(JSON.stringify(result), good.stdout);
  record(
    "acknowledged protected UTF16 directory survives with exact Node identity",
  );

  await assert.rejects(initialize(owned[1], false), (error) => {
    assert.equal(error.code, 1);
    assert.ok(error.stderr.includes("ACOS_PRIVATE_STORAGE_CREATED "));
    return true;
  });
  await missing(owned[1]);
  await initialize(owned[1]);
  record(
    "no ACK removes only provisional empty creation and exclusive retry succeeds",
  );

  await terminateBeforeAck(owned[2]);
  await missing(owned[2]);
  await initialize(owned[2]);
  record(
    "forced death before ACK removes the uncommitted empty object and retry succeeds",
  );

  await terminateBeforeAck(owned[3], async () => {
    await writeFile(
      path.join(owned[3], "retained.txt"),
      "synthetic-not-human",
      { flag: "wx" },
    );
  });
  assert.equal(
    await readFile(path.join(owned[3], "retained.txt"), "utf8"),
    "synthetic-not-human",
  );
  record("forced death retains a populated object and its exact contents");

  await terminateBeforeAck(owned[4], async () => {
    await assert.rejects(rename(owned[4], owned[5]));
  });
  await missing(owned[4]);
  await missing(owned[5]);
  record("provisional pinned handle refuses namespace replacement");
} finally {
  const child = path.join(owned[3], "retained.txt");
  assert.ok(
    path.relative(base, child) && !path.relative(base, child).startsWith(".."),
  );
  await unlink(child).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  for (const target of [...owned].reverse()) {
    assert.ok(
      path.relative(base, target) &&
        !path.relative(base, target).startsWith(".."),
    );
    await rmdir(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await rmdir(base);
}
const report = {
  schema: "agentic-company-os/windows-private-helper-lifetime@1",
  sourceSha256: build.sourceSha256,
  executableSha256: build.executableSha256,
  checks,
  passed: true,
  cleanupVerified: true,
  applicationOrModelStarted: false,
  originalCIIncidentReproduced: false,
  actualMainOrReleaseAccepted: false,
  scope:
    "Original local/component native creation lifetime checks only. No source/PR/main or release qualification.",
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    passed: true,
    checks: checks.length,
    cleanupVerified: true,
    originalCIIncidentReproduced: false,
    actualMainOrReleaseAccepted: false,
  }),
);
