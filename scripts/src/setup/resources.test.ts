import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertInstallPortAvailable,
  createInstallationResources,
  windowsOwnerSid,
} from "./resources";
import { planInstallation } from "./plan";

test("private installation ACL supports local, domain and Microsoft Entra owners", () => {
  for (const sid of [
    "S-1-5-21-123-456-789-1001",
    "S-1-12-1-123-456-789-1001",
    "S-1-5-18",
  ])
    assert.equal(windowsOwnerSid(`"computer\\owner","${sid}"\r\n`), sid);
  for (const value of [
    "",
    '"owner","S-1-5-abc"',
    '"owner","S-1-5-18","S-1-5-19"',
  ])
    assert.throws(() => windowsOwnerSid(value), /owner/u);
});

function plan(mode = "native") {
  return planInstallation(
    {
      mode,
      locale: "tr",
      port: 5000,
      accessMode: "approval",
      provider: "later",
      phoneAccess: "local",
      toolPacks: [],
    },
    {
      platform: "win32",
      architecture: "x64",
      nodeVersion: "v24.20.0",
      postgresClientVersion: null,
      composeVersion: "2.40.0",
      native: { ready: true, issues: [] },
      container: { ready: true, issues: [] },
    },
  );
}

test("installation handles spaces, writes private credentials and refuses to overwrite an instance", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos install resources "),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(path.join(parent, "unrelated.txt"), "keep me");
  const selected = plan();
  const databaseUrl =
    "postgresql://operator:private-password@127.0.0.1:5432/agentic";
  const resources = await createInstallationResources(parent, selected, {
    databaseUrl,
  });
  assert.equal(
    await readFile(resources.secretFiles.database_url, "utf8"),
    databaseUrl,
  );
  const manifest = await readFile(
    path.join(resources.directory, "installation.json"),
    "utf8",
  );
  assert.ok(!manifest.includes("private-password"));
  assert.equal(
    await readFile(path.join(parent, "unrelated.txt"), "utf8"),
    "keep me",
  );
  assert.ok(
    (await readFile(resources.secretFiles.operator_auth_token, "utf8"))
      .length >= 32,
  );
  if (process.platform !== "win32")
    assert.equal(
      (await stat(resources.secretFiles.database_url)).mode & 0o777,
      0o600,
    );
  await assert.rejects(
    createInstallationResources(parent, selected, { databaseUrl }),
    /already exists/,
  );
});

test("container credentials target the compose database and retain independent random secrets", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-container-resources-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const resources = await createInstallationResources(
    parent,
    plan("container"),
    {},
  );
  const url = new URL(
    await readFile(resources.secretFiles.database_url, "utf8"),
  );
  assert.equal(url.hostname, "db");
  assert.equal(
    url.password,
    await readFile(resources.secretFiles.postgres_password!, "utf8"),
  );
  assert.notEqual(
    url.password,
    await readFile(resources.secretFiles.operator_auth_token, "utf8"),
  );
  if (process.platform !== "win32")
    assert.equal(
      (await stat(resources.secretFiles.database_url)).mode & 0o777,
      0o640,
    );
});

test("installation rejects redirected parents and malformed native database URLs", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-redirect-parent-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const alias = `${parent}-alias`;
  await symlink(
    parent,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  t.after(() => rm(alias, { force: true }));
  await assert.rejects(
    createInstallationResources(alias, plan(), {
      databaseUrl: "postgresql://user:password@localhost/db",
    }),
    /redirect|real directory/,
  );
  for (const databaseUrl of [
    "https://localhost/db",
    "postgresql://user:password@localhost/",
    "postgresql://localhost/db\nINJECT=true",
    "",
  ])
    await assert.rejects(
      createInstallationResources(parent, plan(), { databaseUrl }),
    );
});

test("an occupied installation port fails without stopping its owner", async (t) => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await assert.rejects(
    assertInstallPortAvailable(address.port),
    /port_unavailable/,
  );
  assert.equal(server.listening, true);
});
