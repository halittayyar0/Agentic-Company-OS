import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import {
  createSetupSession,
  type SetupProgress,
  type SetupUpgradeReview,
} from "./session";
import type { NativeUpgradeCandidate } from "./native-upgrade-candidate";

const candidate: NativeUpgradeCandidate = {
  mode: "upgrade",
  directory: path.resolve("instance-00000000-0000-0000-0000-000000000001"),
  installationId: "00000000-0000-0000-0000-000000000001",
  locale: "ar",
  sourceVersion: "0.5.5",
  targetVersion: "0.5.6",
  sourceCommit: "a".repeat(40),
  targetCommit: "b".repeat(40),
  metadataSha256: "c".repeat(64),
  pointerSha256: "d".repeat(64),
};
const capabilities = {
  platform: "win32",
  architecture: "x64",
  nodeVersion: "v24.21.0",
  postgresClientVersion: null,
  composeVersion: null,
  native: { ready: true, issues: [], managedDatabase: true },
  container: { ready: false, issues: [] },
};
function client(session: Awaited<ReturnType<typeof createSetupSession>>) {
  const base = session.url.split("#")[0],
    origin = new URL(base).origin;
  const headers = {
    authorization: `Bearer ${session.token}`,
    origin,
    "content-type": "application/json",
  };
  return {
    base,
    headers,
    post: (route: string, body: unknown = {}) =>
      fetch(`${base}api/${route}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    state: async () =>
      (await (
        await fetch(`${base}api/state`, { headers })
      ).json()) as SetupProgress,
  };
}

test("setup upgrade reviews use existing authentication and never disclose backend fields or accept arbitrary actions", async (t) => {
  let inspections = 0;
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw new Error("must not install");
    },
    upgrade: {
      inspect: async () => {
        inspections++;
        return { ...candidate, secret: "fake-private-backend-value" };
      },
      execute: async () => ({ url: "http://127.0.0.1:5031" }),
    },
  });
  t.after(() => session.close());
  const c = client(session);
  assert.equal(
    (
      await fetch(`${c.base}api/upgrade/review`, {
        method: "POST",
        headers: {
          origin: new URL(c.base).origin,
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${c.base}api/upgrade/review`, {
        method: "POST",
        headers: { ...c.headers, origin: "https://untrusted.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  for (const body of [
    { targetRoot: "/other" },
    { directory: 1 },
    { directory: "bad\u0000path" },
  ])
    assert.equal((await c.post("upgrade/review", body)).status, 400);
  assert.equal(inspections, 0);
  const response = await c.post("upgrade/review"),
    text = await response.text(),
    reviewed = JSON.parse(text);
  assert.equal(response.status, 200);
  assert.equal(reviewed.mode, "upgrade");
  assert.equal(reviewed.locale, "ar");
  assert.ok(reviewed.id);
  assert.equal(reviewed.sourceVersion, "0.5.5");
  assert.doesNotMatch(
    text,
    /fake-private-backend-value|metadataSha256|pointerSha256|sourceCommit|targetCommit/u,
  );
  assert.equal(
    (await c.post("upgrade/install", { reviewId: randomUUID() })).status,
    409,
  );
  assert.equal(
    (await c.post("upgrade/install", { reviewId: reviewed.id, mode: "retry" }))
      .status,
    400,
  );
  assert.equal((await c.post("plan", {})).status, 409);
  assert.equal(
    (await c.post("upgrade/dismiss", { reviewId: reviewed.id })).status,
    200,
  );
  assert.equal((await c.state()).phase, "idle");
});

test("reviewed upgrade executes once, refuses cancellation during promotion, and reveals the app key only once", async (t) => {
  let run = 0,
    release!: () => void,
    promote!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const promotion = new Promise<void>((resolve) => {
    promote = resolve;
  });
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw new Error("fresh install forbidden");
    },
    upgrade: {
      inspect: async () => candidate,
      execute: async (_review, _signal, progress) => {
        run++;
        progress({ phase: "copying", copiedFiles: 12 });
        await promotion;
        progress({ phase: "promoting" });
        await wait;
        return {
          url: "http://127.0.0.1:5031",
          operatorToken: "fake-operator-never-in-state",
        };
      },
    },
  });
  t.after(() => session.close());
  const c = client(session),
    reviewed = (await (
      await c.post("upgrade/review")
    ).json()) as SetupUpgradeReview;
  const start = { reviewId: reviewed.id };
  assert.equal((await c.post("upgrade/install", start)).status, 202);
  assert.equal((await c.post("upgrade/install", start)).status, 202);
  assert.equal(run, 1);
  assert.equal((await c.state()).upgrade!.copiedFiles, 12);
  assert.equal((await c.post("upgrade/review")).status, 409);
  promote();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await c.state()).upgrade!.canCancel, false);
  assert.equal((await c.post("upgrade/cancel")).status, 409);
  release();
  await session.settled();
  const state = await c.state();
  assert.equal(state.phase, "complete");
  assert.doesNotMatch(JSON.stringify(state), /fake-operator-never-in-state/u);
  assert.equal((await c.post("upgrade/install", start)).status, 202);
  assert.equal(run, 1);
  assert.deepEqual(await (await c.post("connection")).json(), {
    operatorToken: "fake-operator-never-in-state",
  });
  assert.equal((await c.post("connection")).status, 409);
});

test("preparation can be cancelled and reviewed again without retrying the previous operation", async (t) => {
  let calls = 0;
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw new Error("unused");
    },
    upgrade: {
      inspect: async () => ({
        ...candidate,
        ...(calls ? { mode: "retry" as const, upgradeId: randomUUID() } : {}),
      }),
      execute: async (_review, signal, progress) => {
        calls++;
        progress({ phase: "migrating" });
        await new Promise<void>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("fake-secret-in-internal-error")),
            { once: true },
          );
        });
        return { url: "http://127.0.0.1:5031" };
      },
    },
  });
  t.after(() => session.close());
  const c = client(session),
    old = (await (await c.post("upgrade/review")).json()) as SetupUpgradeReview;
  await c.post("upgrade/install", { reviewId: old.id });
  assert.equal((await c.post("upgrade/cancel")).status, 202);
  await session.settled();
  const state = await c.state();
  assert.equal(state.phase, "failed");
  assert.equal(state.error, "upgrade_cancelled");
  assert.doesNotMatch(JSON.stringify(state), /fake-secret/u);
  const next = (await (
    await c.post("upgrade/review")
  ).json()) as SetupUpgradeReview;
  assert.equal(next.mode, "retry");
  assert.notEqual(next.id, old.id);
  assert.equal(calls, 1);
  assert.equal(
    (await c.post("upgrade/install", { reviewId: old.id })).status,
    409,
  );
});

test("upgrade reviews preserve safe expiry and failure behavior", async (t) => {
  let now = 1000,
    attempts = 0;
  const session = await createSetupSession({
    now: () => now,
    lifetimeMs: 1000,
    capabilities: async () => capabilities,
    execute: async () => {
      throw new Error("unused");
    },
    upgrade: {
      inspect: async () => candidate,
      execute: async () => {
        attempts++;
        throw new Error("private database credential");
      },
    },
  });
  t.after(() => session.close());
  const c = client(session),
    reviewed = (await (
      await c.post("upgrade/review")
    ).json()) as SetupUpgradeReview;
  now = 2000;
  assert.equal(
    (await c.post("upgrade/install", { reviewId: reviewed.id })).status,
    401,
  );
  assert.equal(attempts, 0);
  now = 1500;
  await c.post("upgrade/install", { reviewId: reviewed.id });
  await session.settled();
  const state = await c.state();
  assert.equal(state.error, "upgrade_failed");
  assert.doesNotMatch(JSON.stringify(state), /private database credential/u);
});

test("the reviewed installation snapshot cannot be changed by a later adapter update", async (t) => {
  const mutable = { ...candidate };
  let used: NativeUpgradeCandidate | undefined;
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw new Error("unused");
    },
    upgrade: {
      inspect: async () => mutable,
      execute: async (reviewed) => {
        used = reviewed;
        return { url: "http://127.0.0.1:5031" };
      },
    },
  });
  t.after(() => session.close());
  const c = client(session),
    reviewed = (await (
      await c.post("upgrade/review")
    ).json()) as SetupUpgradeReview;
  mutable.directory = path.resolve("different-installation");
  mutable.metadataSha256 = "e".repeat(64);
  await c.post("upgrade/install", { reviewId: reviewed.id });
  await session.settled();
  assert.equal(used?.directory, candidate.directory);
  assert.equal(used?.metadataSha256, candidate.metadataSha256);
});

test("late discovery and capability replies cannot replace a newer reviewed operation", async (t) => {
  let resolveInspection!: (value: NativeUpgradeCandidate) => void,
    inspectionEntered!: () => void;
  let resolveCapabilities!: (value: typeof capabilities) => void,
    capabilitiesEntered!: () => void;
  const enteredInspection = new Promise<void>((resolve) => {
    inspectionEntered = resolve;
  });
  const enteredCapabilities = new Promise<void>((resolve) => {
    capabilitiesEntered = resolve;
  });
  const slowInspection = new Promise<NativeUpgradeCandidate>((resolve) => {
    resolveInspection = resolve;
  });
  const slowCapabilities = new Promise<typeof capabilities>((resolve) => {
    resolveCapabilities = resolve;
  });
  const session = await createSetupSession({
    capabilities: async () => {
      capabilitiesEntered();
      return slowCapabilities;
    },
    execute: async () => {
      throw new Error("must not execute");
    },
    upgrade: {
      inspect: async (input) => {
        if (input.directory === "slow") {
          inspectionEntered();
          return slowInspection;
        }
        return candidate;
      },
      execute: async () => {
        throw new Error("must not execute");
      },
    },
  });
  t.after(() => {
    resolveInspection(candidate);
    resolveCapabilities(capabilities);
    return session.close();
  });
  const c = client(session);
  const oldPlan = c.post("plan", {
    mode: "native",
    locale: "en",
    port: 5031,
    accessMode: "approval",
    provider: "later",
    phoneAccess: "local",
    toolPacks: [],
  });
  await enteredCapabilities;
  const oldReview = c.post("upgrade/review", { directory: "slow" });
  await enteredInspection;
  const latest = (await (
    await c.post("upgrade/review")
  ).json()) as SetupUpgradeReview;
  resolveInspection({ ...candidate, directory: path.resolve("old-selection") });
  resolveCapabilities(capabilities);
  assert.equal((await oldReview).status, 409);
  assert.equal((await oldPlan).status, 409);
  const state = await c.state();
  assert.equal(state.upgrade?.id, latest.id);
  assert.equal(state.upgrade?.directory, candidate.directory);
});

test("recovery cannot be cancelled even before its first promotion progress frame", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw new Error("unused");
    },
    upgrade: {
      inspect: async () => ({
        ...candidate,
        mode: "recover",
        upgradeId: randomUUID(),
      }),
      execute: async (_review, signal, progress) => {
        progress({ phase: "recovering" });
        await gate;
        assert.equal(signal.aborted, false);
        return { url: "http://127.0.0.1:5031" };
      },
    },
  });
  t.after(() => {
    release();
    return session.close();
  });
  const c = client(session),
    review = (await (
      await c.post("upgrade/review")
    ).json()) as SetupUpgradeReview;
  await c.post("upgrade/install", { reviewId: review.id });
  assert.equal((await c.post("upgrade/cancel")).status, 409);
  assert.equal((await c.state()).upgrade?.canCancel, false);
  release();
  await session.settled();
  assert.equal((await c.state()).phase, "complete");
});
