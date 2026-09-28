import assert from "node:assert/strict";
import test from "node:test";

import {
  probeRuntimeTopology,
  waitForRuntimeTopology,
  waitForRuntimeWorkerReplacement,
} from "./runtime-probe";

test("runtime probe requires loopback and sends the operator token only there", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("authorization"),
    });
    if (String(input).endsWith("/api/readyz")) {
      return Response.json({ status: "ready" });
    }
    return Response.json({
      instances: [
        {
          id: "api-1",
          role: "api",
          effectiveState: "healthy",
          schedulerEnabled: false,
        },
        {
          id: "worker-1",
          role: "worker",
          effectiveState: "healthy",
          schedulerEnabled: true,
        },
        {
          id: "worker-2",
          role: "worker",
          effectiveState: "healthy",
          schedulerEnabled: true,
        },
      ],
    });
  };

  const result = await probeRuntimeTopology({
    baseUrl: "http://127.0.0.1:54321",
    operatorToken: "local-test-token",
    fetchImpl,
  });
  assert.equal(result.ready, true);
  assert.equal(result.apiInstances, 1);
  assert.equal(result.workerInstances, 2);
  assert.equal(result.schedulerWorkers, 2);
  assert.deepEqual(result.healthyWorkerIds, ["worker-1", "worker-2"]);
  assert.equal(requests.length, 2);
  await assert.rejects(
    probeRuntimeTopology({
      baseUrl: "http://name:password@127.0.0.1:54321",
      operatorToken: "fixture",
      fetchImpl,
    }),
    /loopback/,
  );
  assert.equal(requests.length, 2);
  assert.equal(
    requests.every(
      (request) => request.authorization === "Bearer local-test-token",
    ),
    true,
  );

  await assert.rejects(
    probeRuntimeTopology({
      baseUrl: "https://company.example.com",
      operatorToken: "must-not-leak",
      fetchImpl,
    }),
    /loopback/,
  );
  assert.equal(requests.length, 2);
});

test("topology waiter retries bounded transient failures", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    if (calls < 3) throw new Error("not ready yet");
    if (String(input).endsWith("/api/readyz")) {
      return Response.json({ status: "ready" });
    }
    return Response.json({
      instances: [
        {
          id: "api-1",
          role: "api",
          effectiveState: "healthy",
          schedulerEnabled: false,
        },
        {
          id: "worker-1",
          role: "worker",
          effectiveState: "healthy",
          schedulerEnabled: true,
        },
        {
          id: "worker-2",
          role: "worker",
          effectiveState: "healthy",
          schedulerEnabled: true,
        },
      ],
    });
  };

  const result = await waitForRuntimeTopology(
    {
      baseUrl: "http://localhost:54321",
      operatorToken: "token",
      fetchImpl,
    },
    { timeoutMs: 1_000, intervalMs: 5 },
  );
  assert.equal(result.workerInstances, 2);
  assert.equal(calls >= 4, true);
});

test("API-only or undersized worker topology is rejected", async () => {
  const fetchImpl: typeof fetch = async (input) =>
    String(input).endsWith("/api/readyz")
      ? Response.json({ status: "ready" })
      : Response.json({
          instances: [
            {
              id: "api-1",
              role: "api",
              effectiveState: "healthy",
              schedulerEnabled: false,
            },
            {
              id: "worker-1",
              role: "worker",
              effectiveState: "healthy",
              schedulerEnabled: true,
            },
          ],
        });
  await assert.rejects(
    probeRuntimeTopology({
      baseUrl: "http://[::1]:54321",
      operatorToken: "token",
      fetchImpl,
    }),
    /two healthy scheduler workers/,
  );
});

test("runtime probe rejects more than the exact two healthy scheduler workers", async () => {
  const fetchImpl: typeof fetch = async (input) =>
    String(input).endsWith("/api/readyz")
      ? Response.json({ status: "ready" })
      : Response.json({
          instances: [
            {
              id: "api-1",
              role: "api",
              effectiveState: "healthy",
              schedulerEnabled: false,
            },
            ...["worker-1", "worker-2", "worker-3"].map((id) => ({
              id,
              role: "worker",
              effectiveState: "healthy",
              schedulerEnabled: true,
            })),
          ],
        });

  await assert.rejects(
    probeRuntimeTopology({
      baseUrl: "http://127.0.0.1:54321",
      operatorToken: "token",
      fetchImpl,
    }),
    /exactly two healthy scheduler workers/,
  );
});

test("worker replacement waiter rejects stale healthy rows until a new runtime id joins", async () => {
  let instanceProbes = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).endsWith("/api/readyz")) {
      return Response.json({ status: "ready" });
    }
    instanceProbes += 1;
    const workerIds =
      instanceProbes < 3
        ? ["worker-old-1", "worker-old-2"]
        : ["worker-old-2", "worker-new-3"];
    return Response.json({
      instances: [
        {
          id: "api-1",
          role: "api",
          effectiveState: "healthy",
          schedulerEnabled: false,
        },
        ...workerIds.map((id) => ({
          id,
          role: "worker",
          effectiveState: "healthy",
          schedulerEnabled: true,
        })),
      ],
    });
  };

  const result = await waitForRuntimeWorkerReplacement(
    {
      baseUrl: "http://127.0.0.1:54321",
      operatorToken: "token",
      fetchImpl,
    },
    {
      previousWorkerIds: ["worker-old-1", "worker-old-2"],
      timeoutMs: 1_000,
      intervalMs: 5,
    },
  );

  assert.deepEqual(result.healthyWorkerIds, ["worker-new-3", "worker-old-2"]);
  assert.equal(instanceProbes, 3);
});
