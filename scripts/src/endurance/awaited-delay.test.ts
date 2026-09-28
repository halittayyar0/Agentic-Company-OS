import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("driver's awaited polling delay keeps a standalone command alive", () => {
  const moduleUrl = new URL("./docker-wall-clock-driver.ts", import.meta.url)
    .href;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
    import { DockerWallClockDriver } from ${JSON.stringify(moduleUrl)};
    const driver = new DockerWallClockDriver({runId:'delay-proof',seed:1,durationHours:1,
      workspaceRoot:process.cwd(),controlDirectory:process.cwd(),
      baseUrl:'http://127.0.0.1:5000',operatorToken:'test',harness:{}});
    driver.sleep(80).then(() => process.stdout.write('poll-completed'));
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "poll-completed");
});
