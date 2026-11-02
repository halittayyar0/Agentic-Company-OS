import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertNativeUser } from "./native-user";

test("native archives refuse root before creating installation resources", async () => {
  for (const platform of ["linux", "darwin"] as const) {
    await assert.doesNotReject(assertNativeUser({ platform, uid: () => 1000 }));
    await assert.rejects(
      assertNativeUser({ platform, uid: () => 0 }),
      /ordinary user/u,
    );
    await assert.rejects(
      assertNativeUser({ platform, uid: undefined }),
      /ordinary user/u,
    );
  }
});

test("Windows native archives use the fixed bundled token checker without an interpreter and require its exact success", async () => {
  const executable = fileURLToPath(
    new URL(
      "../../../lib/ai-server/src/windows-private-helper.exe",
      import.meta.url,
    ),
  );
  let probes = 0;
  const originalRoot = process.env.SystemRoot;
  try {
    process.env.SystemRoot = "unavailable-interpreter";
    await assertNativeUser({
      platform: "win32",
      run: async (execution) => {
        probes++;
        assert.equal(execution.command, executable);
        assert.deepEqual(execution.args, ["--token-role"]);
        assert.equal(Object.keys(execution.environment).length, 0);
        assert.equal(execution.timeoutMs, 10_000);
        assert.equal(execution.maxBufferBytes, 1024);
        return {
          stdout: "ordinary",
          stderr: "ACOS_PRIVATE_STORAGE_STARTED",
          exitCode: 0,
        };
      },
    });
  } finally {
    if (originalRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalRoot;
  }
  assert.equal(probes, 1);
  await assert.rejects(
    assertNativeUser({
      platform: "win32",
      run: async () => ({
        stdout: "administrator",
        stderr: "ACOS_PRIVATE_STORAGE_STARTED",
        exitCode: 0,
      }),
    }),
    /normally.*administrator/u,
  );
  for (const output of [
    "",
    "ordinary extra",
    "ordinary\nadministrator",
    " ordinary",
    "ordinary\n",
  ])
    await assert.rejects(
      assertNativeUser({
        platform: "win32",
        run: async () => ({
          stdout: output,
          stderr: "ACOS_PRIVATE_STORAGE_STARTED",
          exitCode: 0,
        }),
      }),
      /verify.*permissions/u,
    );
  for (const result of [
    { stdout: "ordinary", stderr: "ACOS_PRIVATE_STORAGE_STARTED", exitCode: 7 },
    { stdout: "ordinary", stderr: "", exitCode: 0 },
    {
      stdout: "ordinary",
      stderr: "ACOS_PRIVATE_STORAGE_STARTED extra",
      exitCode: 0,
    },
  ])
    await assert.rejects(
      assertNativeUser({ platform: "win32", run: async () => result }),
      /verify.*permissions/u,
    );
});
