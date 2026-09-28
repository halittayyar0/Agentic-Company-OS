import assert from "node:assert/strict";
import { mkdtemp, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readInstallation } from "./resume";
import { planInstallation } from "./plan";
import { createInstallationResources } from "./resources";

test("resume retains credentials and completed preferences, rejecting changed installation identity", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos resume "),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const caps = {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    postgresClientVersion: null,
    composeVersion: null,
    native: { ready: true, issues: [] },
    container: { ready: false, issues: [] },
  };
  const plan = planInstallation(
    {
      mode: "native",
      locale: "ar",
      port: 5031,
      accessMode: "approval",
      provider: "later",
      phoneAccess: "local",
      toolPacks: ["data"],
    },
    caps,
  );
  const resources = await createInstallationResources(parent, plan, {
    databaseUrl: "postgresql://local:fixture@127.0.0.1:5432/test",
  });
  const workspace = path.join(parent, "separate checkout"),
    manifest = path.join(resources.directory, "installation.json");
  const saved = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(
    manifest,
    JSON.stringify({
      ...saved,
      phase: "complete",
      workspaceRoot: workspace,
      secretFiles: { operator_auth_token: "/untrusted/file" },
    }),
  );
  const resumed = await readInstallation(
    resources.directory,
    workspace,
    async () => caps,
  );
  assert.equal(resumed.complete, true);
  assert.equal(resumed.plan.settings.locale, "ar");
  assert.equal(resumed.plan.id, plan.id);
  assert.deepEqual(resumed.resources.secretFiles, resources.secretFiles);
  await assert.rejects(
    readInstallation(resources.directory, parent, async () => caps),
    /outside the checkout/,
  );
  await assert.rejects(
    readInstallation(
      resources.directory,
      path.join(parent, "other"),
      async () => caps,
    ),
    /original checkout/,
  );
  await writeFile(
    manifest,
    JSON.stringify({ ...saved, plan: { ...saved.plan, id: "different" } }),
  );
  await assert.rejects(
    readInstallation(resources.directory, workspace, async () => caps),
    /identity/,
  );
});
