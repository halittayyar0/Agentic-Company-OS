import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { applyInstallationPreferences } from "./preferences";
import type { InstallationPlan } from "./plan";

test("setup persists and verifies locale, custom policy and selected packs without publishing credentials", async (t) => {
  let locale = "tr",
    policy = { mode: "approval", custom: null as unknown, revision: 1 },
    packs = { enabledPacks: ["data"], revision: 1 };
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer private-test-token");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : null;
    if (req.url === "/api/settings/locale") {
      if (body) locale = body.locale;
      res.end(JSON.stringify({ locale }));
    } else if (req.url === "/api/settings/execution-policy") {
      if (body) {
        assert.equal(body.expectedRevision, policy.revision);
        policy = {
          mode: body.mode,
          custom: body.custom,
          revision: policy.revision + 1,
        };
      }
      res.end(JSON.stringify(policy));
    } else if (req.url === "/api/skills/packs") {
      if (body) {
        assert.equal(body.expectedRevision, packs.revision);
        packs = {
          enabledPacks: body.enabledPacks,
          revision: packs.revision + 1,
        };
      }
      res.end(JSON.stringify(packs));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const plan: InstallationPlan = {
    id: "test",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    steps: [],
    settings: {
      mode: "native",
      port: 5000,
      provider: "later",
      phoneAccess: "local",
      locale: "ar",
      accessMode: "custom",
      customPermissions: {
        files: true,
        terminal: false,
        browser: false,
        delegation: false,
        sudo: false,
      },
      toolPacks: ["documents", "web"],
    },
  };
  await applyInstallationPreferences(plan, {
    baseUrl: `http://127.0.0.1:${address.port}`,
    operatorToken: "private-test-token",
    directory: process.cwd(),
  });
  assert.equal(locale, "ar");
  assert.deepEqual(policy.custom, plan.settings.customPermissions);
  assert.deepEqual(packs.enabledPacks, ["documents", "web"]);
  await applyInstallationPreferences(plan, {
    baseUrl: `http://127.0.0.1:${address.port}`,
    operatorToken: "private-test-token",
    directory: process.cwd(),
  });
  assert.equal(policy.revision, 2);
  assert.equal(packs.revision, 2);
  await assert.rejects(
    applyInstallationPreferences(plan, {
      baseUrl: "https://example.com",
      operatorToken: "private-test-token",
      directory: process.cwd(),
    }),
    /loopback/,
  );
});
