import assert from "node:assert/strict";
import path from "node:path";
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

test("Windows native archives check the actual token with a fixed system tool and require an ordinary result", async () => {
  const systemRoot = path.resolve("fixture Windows");
  let probes = 0;
  await assertNativeUser({
    platform: "win32",
    systemRoot,
    run: async (execution) => {
      probes++;
      assert.equal(
        execution.command,
        path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      );
      assert.ok(execution.args.includes("-NoProfile"));
      assert.ok(execution.args.includes("-NonInteractive"));
      assert.equal(execution.maxBufferBytes, 1024);
      return { stdout: "ordinary", stderr: "", exitCode: 0 };
    },
  });
  assert.equal(probes, 1);
  await assert.rejects(
    assertNativeUser({
      platform: "win32",
      systemRoot,
      run: async () => ({ stdout: "administrator", stderr: "", exitCode: 0 }),
    }),
    /normally.*administrator/u,
  );
  for (const output of ["", "ordinary extra", "ordinary\nadministrator"])
    await assert.rejects(
      assertNativeUser({
        platform: "win32",
        systemRoot,
        run: async () => ({ stdout: output, stderr: "", exitCode: 0 }),
      }),
      /verify.*permissions/u,
    );
  await assert.rejects(
    assertNativeUser({ platform: "win32", systemRoot: "relative" }),
    /verify.*permissions/u,
  );
});
