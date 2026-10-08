import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { LINUX_OWNED_NAMESPACE_SOURCE } from "./linux-owned-namespace-source";
import { LINUX_NAMESPACE_FIXTURE } from "./testing/linux-namespace-fixture";

const run = promisify(execFile);
const enabled = process.env.ACOS_LINUX_NAMESPACE_TESTS === "1";
if (enabled && process.platform !== "linux") {
  throw new Error("Linux namespace proof requires an actual Linux kernel");
}
for (const scenario of [
  "owner-eof",
  "target-normal",
  "target-crash",
  "owner-killed",
  "guardian-killed",
  "startup-owner-gone",
  "early-owner-killed",
  "not-pid-one",
]) {
  test(
    `Linux owned PID namespace ${scenario}`,
    {
      timeout: 30_000,
      skip: !enabled,
    },
    async () => {
      const temp = await realpath(tmpdir());
      const root = await realpath(
        await mkdtemp(path.join(temp, "acos-linux-namespace-")),
      );
      try {
        await writeFile(
          path.join(root, "guardian.py"),
          LINUX_OWNED_NAMESPACE_SOURCE,
          { mode: 0o600 },
        );
        await writeFile(
          path.join(root, "fixture.py"),
          LINUX_NAMESPACE_FIXTURE,
          { mode: 0o600 },
        );
        const { stdout, stderr } = await run(
          "/usr/bin/python3",
          [path.join(root, "fixture.py"), scenario, root],
          {
            cwd: root,
            env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: root },
            timeout: 25_000,
            maxBuffer: 16_384,
          },
        );
        const proof = JSON.parse(stdout);
        assert.equal(proof.scenario, scenario);
        assert.equal(proof.namespaceEmpty, true);
        assert.equal(proof.passed, true);
        assert.equal(stdout.includes("fixture-only-private-access"), false);
        assert.equal(stderr.includes("fixture-only-private-access"), false);
        assert.equal(
          (await readFile(path.join(root, "guardian.py"), "utf8")).includes(
            "fixture-only-private-access",
          ),
          false,
        );
        console.log(JSON.stringify(proof));
      } finally {
        const actual = await realpath(root);
        assert.equal(path.dirname(actual), temp);
        assert.ok(path.basename(actual).startsWith("acos-linux-namespace-"));
        await rm(actual, { recursive: true, force: true });
      }
    },
  );
}
