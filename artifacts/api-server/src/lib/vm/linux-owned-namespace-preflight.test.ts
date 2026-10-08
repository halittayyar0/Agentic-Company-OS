import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, access, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { prepareLinuxOwnedNamespace } from "./linux-owned-namespace";

const enabled = process.env.ACOS_LINUX_LEGACY_BWRAP_TESTS === "1";
if (enabled && process.platform !== "linux")
  throw new Error("legacy_Bubblewrap_gate_requires_actual_Linux");

test(
  "legacy system Bubblewrap is refused before protected helper creation",
  { skip: !enabled, timeout: 10_000 },
  async () => {
    const { stdout } = await promisify(execFile)("/usr/bin/bwrap", ["--help"]);
    assert.doesNotMatch(stdout, /--argv0\s+VALUE/u);
    const parent = await realpath(tmpdir());
    const root = await realpath(
      await mkdtemp(path.join(parent, "acos-legacy-bwrap-proof-")),
    );
    const helper = path.join(root, "helper");
    try {
      await assert.rejects(prepareLinuxOwnedNamespace(helper), {
        message: "owned_linux_runtime_unsupported",
      });
      await assert.rejects(access(helper), { code: "ENOENT" });
    } finally {
      assert.equal(path.dirname(root), parent);
      assert.ok(path.basename(root).startsWith("acos-legacy-bwrap-proof-"));
      await rm(root, { recursive: true, force: true });
    }
  },
);
