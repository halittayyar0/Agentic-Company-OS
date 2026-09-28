import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";

interface SessionIdentity {
  readonly sessionId: string;
  readonly sessionEpoch: number;
}

interface AffinityApi {
  getExistingBrowserSessionIdentity(
    agentId: number,
  ): Promise<SessionIdentity | null>;
  getExistingBrowserActionBinding(
    agentId: number,
    ref: number,
  ): Promise<
    | ({ readonly sessionId: string; readonly sessionEpoch: number } & Record<
        string,
        unknown
      >)
    | null
  >;
}

const browserRuntime = await import("./browser");
const affinityApi = browserRuntime as typeof browserRuntime &
  Partial<AffinityApi>;

function assertAffinityApi(
  candidate: typeof affinityApi,
): asserts candidate is typeof browserRuntime & AffinityApi {
  assert.equal(
    typeof candidate.getExistingBrowserSessionIdentity,
    "function",
    "browser runtime must expose an existing-session-only identity lookup",
  );
  assert.equal(
    typeof candidate.getExistingBrowserActionBinding,
    "function",
    "browser runtime must expose an existing-session-only binding lookup",
  );
}

function refFor(snapshotLines: string[], label: string): number {
  const line = snapshotLines.find((candidate) => candidate.includes(label));
  const match = line?.match(/\[ref=(\d+)\]/);
  assert.ok(match, `snapshot must contain a ref for ${label}`);
  return Number(match[1]);
}

test(
  "existing-only browser affinity survives a session and advances only when that agent gets a new session",
  { timeout: 90_000 },
  async (t) => {
    assertAffinityApi(affinityApi);

    const firstAgentId = 8_000_000 + Math.floor(Math.random() * 100_000);
    const secondAgentId = firstAgentId + 100_000;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><body><button>Affinity target</button></body></html>",
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/`;

    t.after(async () => {
      await Promise.all([
        browserRuntime.closeSession(firstAgentId),
        browserRuntime.closeSession(secondAgentId),
      ]);
      const { closeBrowserEgressProxy } =
        await import("./browser-egress-proxy");
      await closeBrowserEgressProxy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });

    assert.equal(
      await affinityApi.getExistingBrowserSessionIdentity(firstAgentId),
      null,
    );
    assert.equal(
      await affinityApi.getExistingBrowserActionBinding(firstAgentId, 1),
      null,
    );
    assert.equal(
      (await browserRuntime.inspectBrowserSession(firstAgentId)).active,
      false,
      "existing-only lookups must not launch a browser",
    );

    await browserRuntime.navigateTo(firstAgentId, url);
    const firstSnapshot = await browserRuntime.snapshotPage(firstAgentId);
    const firstRef = refFor(firstSnapshot.lines, "Affinity target");
    const firstIdentity =
      await affinityApi.getExistingBrowserSessionIdentity(firstAgentId);
    assert.ok(firstIdentity);
    assert.match(
      firstIdentity.sessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(firstIdentity.sessionEpoch, 1);

    const publicBinding = await browserRuntime.getBrowserActionBinding(
      firstAgentId,
      firstRef,
    );
    assert.equal(publicBinding.sessionId, firstIdentity.sessionId);
    assert.equal(publicBinding.sessionEpoch, firstIdentity.sessionEpoch);
    assert.deepEqual(
      await affinityApi.getExistingBrowserActionBinding(firstAgentId, firstRef),
      publicBinding,
    );

    const beforeMissingRef =
      await browserRuntime.inspectBrowserSession(firstAgentId);
    assert.equal(
      await affinityApi.getExistingBrowserActionBinding(
        firstAgentId,
        Number.MAX_SAFE_INTEGER,
      ),
      null,
    );
    const afterMissingRef =
      await browserRuntime.inspectBrowserSession(firstAgentId);
    assert.equal(afterMissingRef.url, beforeMissingRef.url);
    assert.deepEqual(
      await affinityApi.getExistingBrowserSessionIdentity(firstAgentId),
      firstIdentity,
      "a lookup miss must not navigate or rebind the existing session",
    );

    assert.equal(await browserRuntime.closeSession(firstAgentId), true);
    assert.equal(
      await affinityApi.getExistingBrowserSessionIdentity(firstAgentId),
      null,
    );
    assert.equal(
      await affinityApi.getExistingBrowserActionBinding(firstAgentId, firstRef),
      null,
    );

    await browserRuntime.navigateTo(firstAgentId, url);
    const secondIdentity =
      await affinityApi.getExistingBrowserSessionIdentity(firstAgentId);
    assert.ok(secondIdentity);
    assert.notEqual(secondIdentity.sessionId, firstIdentity.sessionId);
    assert.equal(secondIdentity.sessionEpoch, 2);

    await browserRuntime.ensureSession(secondAgentId);
    const otherAgentIdentity =
      await affinityApi.getExistingBrowserSessionIdentity(secondAgentId);
    assert.ok(otherAgentIdentity);
    assert.equal(
      otherAgentIdentity.sessionEpoch,
      1,
      "epochs must be counted independently per agent",
    );
    assert.notEqual(otherAgentIdentity.sessionId, secondIdentity.sessionId);
  },
);

test(
  "approved click and fill never relaunch a closed bound session before dispatch",
  { timeout: 120_000 },
  async (t) => {
    assertAffinityApi(affinityApi);

    const firstAgentId = 8_300_000 + Math.floor(Math.random() * 100_000);
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <button>Approved target</button>
        <input aria-label="Approved input" />
      </body></html>`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/`;

    const agentIds = [firstAgentId, firstAgentId + 1];
    t.after(async () => {
      await Promise.all(
        agentIds.map((agentId) =>
          browserRuntime.closeSession(agentId).catch(() => undefined),
        ),
      );
      const { closeBrowserEgressProxy } =
        await import("./browser-egress-proxy");
      await closeBrowserEgressProxy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });

    const cases = [
      {
        agentId: agentIds[0]!,
        label: "Approved target",
        dispatch: (
          agentId: number,
          ref: number,
          binding: Awaited<
            ReturnType<typeof browserRuntime.getBrowserActionBinding>
          >,
          beforeEffect: () => Promise<void>,
        ) => browserRuntime.clickRef(agentId, ref, binding, beforeEffect),
      },
      {
        agentId: agentIds[1]!,
        label: "Approved input",
        dispatch: (
          agentId: number,
          ref: number,
          binding: Awaited<
            ReturnType<typeof browserRuntime.getBrowserActionBinding>
          >,
          beforeEffect: () => Promise<void>,
        ) =>
          browserRuntime.fillRef(
            agentId,
            ref,
            "must-not-be-filled",
            binding,
            beforeEffect,
          ),
      },
    ] as const;

    for (const testCase of cases) {
      await browserRuntime.navigateTo(testCase.agentId, url);
      const snapshot = await browserRuntime.snapshotPage(testCase.agentId);
      const ref = refFor(snapshot.lines, testCase.label);
      const binding = await browserRuntime.getBrowserActionBinding(
        testCase.agentId,
        ref,
      );
      const originalIdentity: SessionIdentity | null =
        await affinityApi.getExistingBrowserSessionIdentity(testCase.agentId);
      assert.ok(originalIdentity);
      assert.equal(binding.sessionId, originalIdentity.sessionId);
      assert.equal(binding.sessionEpoch, originalIdentity.sessionEpoch);

      assert.equal(await browserRuntime.closeSession(testCase.agentId), true);
      let beforeEffectCalls = 0;
      await assert.rejects(
        () =>
          testCase.dispatch(testCase.agentId, ref, binding, async () => {
            beforeEffectCalls += 1;
          }),
        /oturum.*(yok|degisti|kapandi)|yeni onay/i,
      );
      assert.equal(beforeEffectCalls, 0, "effect boundary must not be reached");
      assert.equal(
        (await browserRuntime.inspectBrowserSession(testCase.agentId)).active,
        false,
        "an approved dispatch must not create a replacement browser",
      );
      assert.equal(
        await affinityApi.getExistingBrowserSessionIdentity(testCase.agentId),
        null,
      );

      await browserRuntime.ensureSession(testCase.agentId);
      const explicitlyCreatedIdentity: SessionIdentity | null =
        await affinityApi.getExistingBrowserSessionIdentity(testCase.agentId);
      assert.ok(explicitlyCreatedIdentity);
      assert.equal(
        explicitlyCreatedIdentity.sessionEpoch,
        originalIdentity.sessionEpoch + 1,
        "the failed approved dispatch must not consume a session epoch",
      );
      await browserRuntime.closeSession(testCase.agentId);
    }
  },
);
