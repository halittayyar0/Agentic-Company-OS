import assert from "node:assert/strict";
import test from "node:test";
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.OPERATOR_AUTH_TOKEN = "source-test-operator-token-32-characters";
const { default: app } = await import("../app");
const { dbReady, closeDatabase } = await import("@workspace/db");
test.after(() => closeDatabase());
test("source operations require operator authentication and reject malformed revisions", async (t) => {
  await dbReady;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/source-changes`;
  for (const [endpoint, method] of [
    ["", "GET"],
    ["", "POST"],
    ["/invalid", "GET"],
    ["/invalid/check", "POST"],
    ["/invalid/apply", "POST"],
    ["/invalid/rollback", "POST"],
  ]) {
    assert.equal(
      (
        await fetch(base + endpoint, {
          method,
          headers: { "content-type": "application/json" },
          ...(method === "POST" ? { body: "{}" } : {}),
        })
      ).status,
      401,
    );
  }
  const headers = {
    authorization: `Bearer ${process.env.OPERATOR_AUTH_TOKEN}`,
    "content-type": "application/json",
  };
  const response = await fetch(base, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), []);
  for (const endpoint of [
    "",
    "/invalid/check",
    "/invalid/apply",
    "/invalid/rollback",
  ])
    assert.equal(
      (await fetch(base + endpoint, { method: "POST", headers, body: "{}" }))
        .status,
      400,
    );
});
