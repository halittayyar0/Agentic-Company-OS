import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("closing during database initialization joins migration and all shutdown callers exit", async () => {
  // Natural child exit proves no late-created database client survives shutdown.
  // The process deadline also contains a regression in PGlite startup/close.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import assert from "node:assert/strict";
       import { closeDatabase, dbReady, checkDatabaseReady } from "./lib/db/src/index.ts";
       const first = closeDatabase();
       const second = closeDatabase();
       assert.equal(first, second);
       assert.equal(await checkDatabaseReady(), false);
       await Promise.all([first, second, dbReady]);
       await closeDatabase();
       assert.equal(await checkDatabaseReady(), false);
       console.log("early-shutdown-complete");`,
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: "" },
      timeout: 30_000,
      windowsHide: true,
    },
  );
  assert.match(stdout, /early-shutdown-complete/);
});
