import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { testLoaderUrl } from "../test-node-options";

test("native installation proof uses the runner artifact root and retains the local OS fallback", async () => {
  const fixture = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-native-evidence-root-"),
  );
  try {
    for (const onRunner of [true, false]) {
      const root = path.join(fixture, onRunner ? "runner" : "local");
      const hostTemp = path.join(root, "host-temp");
      const runnerTemp = path.join(root, "runner-temp");
      const missingPostgres = path.join(root, "missing-postgres");
      await Promise.all(
        [hostTemp, runnerTemp, missingPostgres].map((dir) =>
          mkdir(dir, { recursive: true }),
        ),
      );
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        TMPDIR: hostTemp,
        TEMP: hostTemp,
        TMP: hostTemp,
      };
      delete environment.RUNNER_TEMP;
      if (onRunner) environment.RUNNER_TEMP = runnerTemp;
      const smokeUrl = new URL("./native-install-smoke.ts", import.meta.url);
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          testLoaderUrl,
          "--input-type=module",
          "--eval",
          `import assert from "node:assert/strict";
          const { runNativeInstallSmoke } = await import(process.argv[1]);
          await assert.rejects(
            runNativeInstallSmoke(process.argv[2], "unused-pnpm.cjs"),
            /initdb(?:\\.exe)? failed:.*ENOENT/su,
          );
          process.stdout.write("owned-proof-directory-created-before-database-start");`,
          smokeUrl.href,
          missingPostgres,
        ],
        {
          env: environment,
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(
        child.stdout,
        "owned-proof-directory-created-before-database-start",
      );
      const collectedRoot = onRunner ? runnerTemp : hostTemp;
      const directories = (await readdir(collectedRoot)).filter((name) =>
        name.startsWith("acos-native-install-proof-"),
      );
      assert.equal(
        directories.length,
        1,
        "proof must be in the collector root",
      );
      assert.match(directories[0], /^acos-native-install-proof-/u);
      assert.deepEqual(
        (await readdir(path.join(collectedRoot, directories[0]))).sort(),
        ["native-installation-failure.json", "password"],
      );
      const failureText = await readFile(
        path.join(
          collectedRoot,
          directories[0],
          "native-installation-failure.json",
        ),
        "utf8",
      );
      assert.deepEqual(JSON.parse(failureText), {
        schemaVersion: 1,
        passed: false,
        platform: process.platform,
        architecture: process.arch,
        stage: "initialize_database",
        errorCode: "native_installation_proof_failed",
        protectionReason: null,
      });
      assert.equal(failureText.includes(collectedRoot), false);
      assert.equal(
        failureText.includes(
          await readFile(
            path.join(collectedRoot, directories[0], "password"),
            "utf8",
          ),
        ),
        false,
      );
      assert.deepEqual(
        (await readdir(onRunner ? hostTemp : runnerTemp)).filter((name) =>
          name.startsWith("acos-native-install-proof-"),
        ),
        [],
      );
    }
  } finally {
    // Every child path is inside this uniquely created, canonical fixture.
    await rm(fixture, { recursive: true, force: true });
  }
});
