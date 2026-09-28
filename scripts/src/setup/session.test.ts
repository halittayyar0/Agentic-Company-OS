import assert from "node:assert/strict";
import { get } from "node:http";
import test from "node:test";
import { createSetupSession } from "./session";
import type { InstallCapabilities } from "./preflight";

const capabilities: InstallCapabilities = {
  platform: "linux",
  architecture: "x64",
  nodeVersion: "v24.20.0",
  postgresClientVersion: null,
  composeVersion: "2.40.0",
  native: { ready: true, issues: [] },
  container: { ready: true, issues: [] },
};
const settings = {
  mode: "container",
  locale: "en",
  port: 5000,
  accessMode: "approval",
  provider: "later",
  phoneAccess: "local",
  toolPacks: [],
};

test("setup rejects missing tokens, cross-site origins and unknown hosts", async (t) => {
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => ({ url: "http://127.0.0.1:5000" }),
  });
  t.after(() => session.close());
  const base = session.url.split("#")[0];
  const headers = {
    authorization: `Bearer ${session.token}`,
    origin: new URL(base).origin,
    "content-type": "application/json",
  };
  assert.equal((await fetch(`${base}api/state`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}api/plan`, {
        method: "POST",
        headers: { ...headers, origin: "https://attacker.example" },
        body: JSON.stringify(settings),
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise<number | undefined>((resolve, reject) => {
      get(
        `${base}api/state`,
        { headers: { ...headers, host: "attacker.example" } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      ).once("error", reject);
    }),
    403,
  );
  assert.equal((await fetch(`${base}api/state`, { headers })).status, 200);
});

test("installation requires the reviewed exact plan and duplicate submits execute once", async (t) => {
  let executions = 0;
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      executions++;
      await wait;
      return { url: "http://127.0.0.1:5000" };
    },
  });
  t.after(() => session.close());
  const base = session.url.split("#")[0];
  const headers = {
    authorization: `Bearer ${session.token}`,
    origin: new URL(base).origin,
    "content-type": "application/json",
  };
  const post = (route: string, body: unknown) =>
    fetch(`${base}api/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const response = await post("plan", settings);
  const plan = (await response.json()) as { id: string };
  assert.equal(
    (await post("install", { planId: "forged", credentials: {} })).status,
    409,
  );
  assert.equal(
    (await post("install", { planId: plan.id, credentials: {} })).status,
    202,
  );
  assert.equal(
    (await post("install", { planId: plan.id, credentials: {} })).status,
    202,
  );
  assert.equal((await post("plan", settings)).status, 409);
  assert.equal(executions, 1);
  finish();
  await session.settled();
  const state = (await (
    await fetch(`${base}api/state`, { headers })
  ).json()) as { phase: string };
  assert.equal(state.phase, "complete");
  assert.equal(
    (await post("install", { planId: plan.id, credentials: {} })).status,
    409,
  );
});

test("setup failure output never reflects credentials or internal error messages", async (t) => {
  const secret = "sensitive-database-password";
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw Error(secret);
    },
  });
  t.after(() => session.close());
  const base = session.url.split("#")[0];
  const headers = {
    authorization: `Bearer ${session.token}`,
    origin: new URL(base).origin,
    "content-type": "application/json",
  };
  const plan = (await (
    await fetch(`${base}api/plan`, {
      method: "POST",
      headers,
      body: JSON.stringify(settings),
    })
  ).json()) as { id: string };
  await fetch(`${base}api/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      planId: plan.id,
      credentials: { databaseUrl: `postgresql://user:${secret}@localhost/db` },
    }),
  });
  await session.settled();
  const state = await (await fetch(`${base}api/state`, { headers })).text();
  assert.ok(!state.includes(secret));
  assert.match(state, /installation_failed/);
});

test("expired setup sessions cannot start an installation", async (t) => {
  let time = 0;
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => ({ url: "http://127.0.0.1:5000" }),
    now: () => time,
    lifetimeMs: 1000,
  });
  t.after(() => session.close());
  time = 1001;
  assert.equal(
    (
      await fetch(`${session.url.split("#")[0]}api/state`, {
        headers: { authorization: `Bearer ${session.token}` },
      })
    ).status,
    401,
  );
});
