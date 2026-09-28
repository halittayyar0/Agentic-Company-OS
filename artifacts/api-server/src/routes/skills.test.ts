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
const { dbReady, closeDatabase } = await import("@workspace/db");
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
});
