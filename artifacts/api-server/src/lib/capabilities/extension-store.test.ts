import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, dbReady } from "@workspace/db";
import {
  saveExtension,
  listExtensions,
  executeInstalledTool,
  exportExtension,
  setCapabilityPacks,
  readCapabilityPacks,
} from "./extension-store";
import { validateExtensionPackage } from "./extension-manifest";
test.before(() => dbReady);
test.after(() => closeDatabase());
const manifest = {
  schemaVersion: 1,
  id: "user-total",
  kind: "tool",
  title: "Total",
  description: "Sum supplied values",
  tool: "calculate",
  defaults: { operation: "add" },
};
test("invalid and shadowing packages never partially install", async () => {
  for (const change of [
    { id: "calculate" },
    { id: "user-../x" },
    { apiKey: "secret" },
    { tool: "vm_run_command" },
    { description: "x".repeat(2001) },
  ])
    assert.throws(() => validateExtensionPackage({ ...manifest, ...change }));
  assert.deepEqual(await listExtensions(), []);
});
test("installed tools survive store reads, use strict built-in validation, and stop after disable", async () => {
  const saved = await saveExtension({
    manifest,
    expectedRevision: 0,
    enabled: true,
  });
  assert.equal(saved.revision, 1);
  assert.equal((await listExtensions())[0].manifest.title, "Total");
  assert.equal(
    (await executeInstalledTool("user-total", { values: [2, 3] }, "en")).value,
    5,
  );
  await assert.rejects(
    executeInstalledTool(
      "user-total",
      { values: [2, 3], command: "anything" },
      "en",
    ),
  );
  await assert.rejects(
    saveExtension({ manifest, expectedRevision: 0, enabled: true }),
    /REVISION_CONFLICT/,
  );
  const exported = await exportExtension("user-total");
  assert.deepEqual(exported, manifest);
  await saveExtension({ manifest, expectedRevision: 1, enabled: false });
  await assert.rejects(
    executeInstalledTool("user-total", { values: [2, 3] }, "en"),
    /EXTENSION_DISABLED/,
  );
});
test("pack selections persist by revision and reject unknown packs", async () => {
  const state = await readCapabilityPacks();
  await setCapabilityPacks({
    enabledPacks: ["documents"],
    expectedRevision: state.revision,
  });
  assert.deepEqual((await readCapabilityPacks()).enabledPacks, ["documents"]);
  await assert.rejects(
    setCapabilityPacks({
      enabledPacks: ["unknown"],
      expectedRevision: state.revision + 1,
    }),
  );
});
