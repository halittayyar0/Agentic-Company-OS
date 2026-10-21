import assert from "node:assert/strict";
import test from "node:test";
import { launchSetup } from "./bootstrap";

test("upgrade commands refuse a source checkout before capability probes, data creation or app startup", async () => {
  for (const flag of ["--upgrade", "--recover-upgrade", "--retry-upgrade"]) {
    await assert.rejects(
      launchSetup([flag, "never-create-this-instance", "--no-browser"]),
      /^Error: native_upgrade_package_required$/u,
    );
  }
});
