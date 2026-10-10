import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_LOCALES } from "../lib/workspace-locale";
import { getCapabilityCatalog } from "../lib/capabilities/catalog";
import { GetCapabilityCatalogResponse } from "@workspace/api-zod";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const token = "capability-catalog-test-token-32-characters";
process.env.OPERATOR_AUTH_TOKEN = token;
const { default: app } = await import("../app");
const { dbReady, closeDatabase, db, capabilityInstallationsTable } =
  await import("@workspace/db");
test.after(async () => {
  await closeDatabase();
});

test("the real catalog route requires authentication and validates every locale", async (t) => {
  await dbReady;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/skills`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { authorization: `Bearer ${token}` };
  for (const locale of WORKSPACE_LOCALES) {
    const response = await fetch(`${url}?locale=${locale}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.deepEqual(
      GetCapabilityCatalogResponse.parse(body),
      getCapabilityCatalog(locale),
    );
  }
  for (const query of [
    "locale=fr",
    "locale=en&locale=ar",
    "locale=en&extra=true",
  ]) {
    assert.equal((await fetch(`${url}?${query}`, { headers })).status, 400);
  }
  assert.equal((await fetch(url, { method: "POST", headers })).status, 404);
  const jsonHeaders = { ...headers, "content-type": "application/json" };
  for (const endpoint of [
    "extensions",
    "packs",
    "extensions/user-test/export",
  ]) {
    assert.equal((await fetch(`${url}/${endpoint}`)).status, 401);
  }
  const manifest = {
    schemaVersion: 1,
    id: "user-http-guide",
    kind: "skill",
    title: "HTTP guide",
    description: "A test guide",
    instructions: "Review the result.",
  };
  const save = (body: unknown) =>
    fetch(`${url}/extensions`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await fetch(`${url}/extensions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest, enabled: true, expectedRevision: 0 }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await save({
        manifest: { ...manifest, apiKey: "never-export" },
        enabled: true,
        expectedRevision: 0,
      })
    ).status,
    400,
  );
  assert.equal(
    (await save({ manifest, enabled: true, expectedRevision: 0 })).status,
    200,
  );
  assert.equal(
    (await save({ manifest, enabled: true, expectedRevision: 0 })).status,
    409,
  );
  assert.deepEqual(
    await (
      await fetch(`${url}/extensions/${manifest.id}/export`, { headers })
    ).json(),
    manifest,
  );
  assert.equal(
    (await save({ manifest, enabled: false, expectedRevision: 1 })).status,
    200,
  );
  const entries = (await (
    await fetch(`${url}/extensions`, { headers })
  ).json()) as { id: string; enabled: boolean }[];
  assert.equal(
    entries.find((entry: { id: string }) => entry.id === manifest.id)?.enabled,
    false,
  );
  const packs = (await (await fetch(`${url}/packs`, { headers })).json()) as {
    revision: number;
  };
  const updatePacks = (body: unknown) =>
    fetch(`${url}/packs`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await updatePacks({
        enabledPacks: ["unknown"],
        expectedRevision: packs.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (await updatePacks({ enabledPacks: [], expectedRevision: packs.revision }))
      .status,
    200,
  );
  assert.equal(
    (
      await updatePacks({
        enabledPacks: ["data"],
        expectedRevision: packs.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    GetCapabilityCatalogResponse.parse(
      await (await fetch(`${url}?locale=en`, { headers })).json(),
    ).skills.length,
    0,
  );
  const unsupported = await save({
    manifest: {
      schemaVersion: 1,
      id: "user-unsupported",
      title: "Unsupported",
      description: "Unsupported tool",
      kind: "tool",
      tool: "not-a-supported-tool",
      defaults: {},
    },
    enabled: false,
    expectedRevision: 0,
  });
  assert.equal(unsupported.status, 400);
  assert.deepEqual(await unsupported.json(), { code: "CAPABILITY_INVALID" });
  // Seed a full installed catalog without exhausting the HTTP write limiter.
  await db.insert(capabilityInstallationsTable).values(
    Array.from({ length: 99 }, (_, index) => ({
      id: `user-capacity-${index}`,
      manifest: { ...manifest, id: `user-capacity-${index}` },
      enabled: false,
    })),
  );
  const overflow = await save({
    manifest: { ...manifest, id: "user-capacity-overflow" },
    enabled: false,
    expectedRevision: 0,
  });
  assert.equal(overflow.status, 400);
  assert.deepEqual(await overflow.json(), { code: "CAPABILITY_INVALID" });
  assert.equal(
    (
      (await (
        await fetch(`${url}/extensions`, { headers })
      ).json()) as unknown[]
    ).length,
    100,
  );
  assert.equal(
    (await save({ manifest, enabled: false, expectedRevision: 2 })).status,
    200,
  );
});
