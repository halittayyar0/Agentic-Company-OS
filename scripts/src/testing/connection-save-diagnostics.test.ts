import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionSaveDiagnostics } from "./connection-save-diagnostics";

test("auth transport distinguishes received headers from a finished body without reviving terminal requests", () => {
  let now = 100;
  const diagnostics = createConnectionSaveDiagnostics(
    "http://127.0.0.1:4173",
    () => now,
  );
  const request = {
    id: 1,
    url: "http://127.0.0.1:4173/api/auth/status",
    method: "GET",
  };
  diagnostics.requestStarted(request);
  assert.equal(
    diagnostics.snapshot().authTransport?.requests[0]?.phase,
    "waiting_headers",
  );
  now = 110;
  diagnostics.observe({
    ...request,
    requestId: request.id,
    status: 200,
    headers: {},
  });
  let observation = diagnostics.snapshot().authTransport!.requests[0]!;
  assert.equal(observation.phase, "waiting_body");
  assert.equal(observation.finishedAtMs, null);
  assert.equal(observation.status, 200);
  now = 115;
  diagnostics.requestFinished(request);
  diagnostics.requestFailed(request, "net::ERR_ABORTED");
  observation = diagnostics.snapshot().authTransport!.requests[0]!;
  assert.equal(observation.phase, "finished");
  assert.equal(observation.finishedAtMs, 15);
  assert.equal(diagnostics.snapshot().authTransport?.ignoredEvents, 1);
  const next = { ...request, id: 2 };
  diagnostics.requestStarted(next);
  diagnostics.requestFailed(next, "net::ERR_ABORTED");
  assert.equal(
    diagnostics.snapshot().authTransport?.requests[1]?.failureKind,
    "aborted",
  );
});

test("auth lifecycle observations reject unsafe identities and retain no URL, body or arbitrary failure text", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  const request = {
    id: 1,
    url: "http://127.0.0.1:4173/api/auth/status?account=secret-query",
    method: "GET",
  };
  for (const patch of [
    { url: "http://secret:secret@127.0.0.1:4173/api/auth/status" },
    { url: "https://outside.example/api/auth/status" },
    { url: "http://127.0.0.1:4173/api/auth/status/secret" },
    { url: "not a URL" },
    { method: "POST" },
    { id: 0 },
    { id: NaN },
  ])
    diagnostics.requestStarted({ ...request, ...patch });
  assert.equal(diagnostics.snapshot().authTransport, undefined);
  diagnostics.requestStarted(request);
  diagnostics.requestStarted(request);
  diagnostics.observe({
    ...request,
    requestId: 1,
    status: 200,
    headers: {
      authorization: "Bearer secret-token",
      "set-cookie": "secret-cookie",
    },
  });
  diagnostics.requestFailed(
    request,
    "Bearer secret-token at C:\\private\\account",
  );
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.authTransport?.totalRequests, 1);
  assert.equal(snapshot.authTransport?.ignoredEvents, 1);
  assert.equal(snapshot.authTransport?.requests[0]?.failureKind, "other");
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /secret|account|Bearer|127\.0\.0\.1|outside|authorization|cookie|private/u,
  );
});

test("auth transport keeps a bounded detached window and never recreates a dropped request", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  const request = {
    id: 1,
    url: "http://127.0.0.1:4173/api/auth/status",
    method: "GET",
  };
  for (let id = 1; id <= 20; id++)
    diagnostics.requestStarted({ ...request, id });
  const snapshot = diagnostics.snapshot().authTransport!;
  assert.equal(snapshot.totalRequests, 20);
  assert.equal(snapshot.droppedRequests, 4);
  assert.equal(snapshot.requests.length, 16);
  assert.equal(snapshot.requests[0]?.id, 5);
  snapshot.requests[0]!.phase = "finished";
  snapshot.requests.pop();
  diagnostics.requestFinished(request);
  const fresh = diagnostics.snapshot().authTransport!;
  assert.equal(fresh.requests.length, 16);
  assert.equal(fresh.requests[0]?.phase, "waiting_headers");
  assert.equal(fresh.ignoredEvents, 1);
});

test("connection save diagnostics retain only bounded status and numeric rate headers", () => {
  let now = 100;
  const diagnostics = createConnectionSaveDiagnostics(
    "http://127.0.0.1:4173",
    () => now,
  );
  diagnostics.observe({
    url: "http://127.0.0.1:4173/api/settings/llm?private=secret-query",
    method: "PUT",
    status: 429,
    headers: {
      authorization: "Bearer secret-token",
      "set-cookie": "secret-cookie",
      "ratelimit-limit": "300",
      "ratelimit-remaining": "0",
      "ratelimit-reset": "9",
      "retry-after": "9",
    },
  });
  now = 150;
  diagnostics.observe({
    url: "http://127.0.0.1:4173/api/settings/llm",
    method: "GET",
    status: 503,
    headers: {
      "retry-after": "secret-header",
      "ratelimit-limit": "99999999999999999999",
    },
  });
  assert.deepEqual(diagnostics.snapshot(), {
    totalResponses: 2,
    droppedResponses: 0,
    responses: [
      {
        atMs: 0,
        method: "PUT",
        status: 429,
        limit: 300,
        remaining: 0,
        resetSeconds: 9,
        retryAfterSeconds: 9,
      },
      {
        atMs: 50,
        method: "GET",
        status: 503,
        limit: null,
        remaining: null,
        resetSeconds: null,
        retryAfterSeconds: null,
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(diagnostics.snapshot()),
    /secret|127\.0\.0\.1|authorization|cookie|private/u,
  );
});

test("connection diagnostics ignore other origins, paths, credentials, methods and invalid statuses", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  const valid = {
    url: "http://127.0.0.1:4173/api/settings/llm",
    method: "PUT",
    status: 200,
    headers: {},
  };
  for (const patch of [
    { url: "https://outside.example/api/settings/llm" },
    { url: "http://127.0.0.1:4173/api/tasks/private-account" },
    { url: "http://secret:secret@127.0.0.1:4173/api/settings/llm" },
    { url: "not a URL" },
    { method: "POST" },
    { status: 99 },
    { status: 600 },
    { status: Number.NaN },
  ])
    diagnostics.observe({ ...valid, ...patch });
  assert.deepEqual(diagnostics.snapshot(), {
    totalResponses: 0,
    droppedResponses: 0,
    responses: [],
  });
});

test("connection diagnostics preserve the latest bounded observations and return detached snapshots", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  for (let i = 0; i < 80; i++)
    diagnostics.observe({
      url: "http://127.0.0.1:4173/api/settings/llm",
      method: "PUT",
      status: i === 79 ? 429 : 200,
      headers: {},
    });
  const first = diagnostics.snapshot();
  assert.equal(first.totalResponses, 80);
  assert.equal(first.droppedResponses, 16);
  assert.equal(first.responses.length, 64);
  assert.equal(first.responses.at(-1)?.status, 429);
  first.responses[0]!.status = 500;
  first.responses.pop();
  assert.equal(diagnostics.snapshot().responses.length, 64);
  assert.equal(diagnostics.snapshot().responses[0]!.status, 200);
});

test("catalog failure observations identify only the fixed GET resource and numeric rate headers", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  diagnostics.observe({
    url: "http://127.0.0.1:4173/api/model-catalog?account=secret-query",
    method: "GET",
    status: 429,
    headers: {
      authorization: "Bearer secret-token",
      "set-cookie": "secret-cookie",
      "ratelimit-limit": "300",
      "ratelimit-remaining": "0",
      "ratelimit-reset": "7",
      "retry-after": "7",
    },
  });
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.totalResponses, 1);
  assert.deepEqual(snapshot.responses[0], {
    resource: "model-catalog",
    atMs: snapshot.responses[0]?.atMs,
    method: "GET",
    status: 429,
    limit: 300,
    remaining: 0,
    resetSeconds: 7,
    retryAfterSeconds: 7,
  });
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /secret|account|127\.0\.0\.1|authorization|cookie/u,
  );
});

test("catalog observations reject mutations, redirected origins and arbitrary catalog paths", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  const valid = {
    url: "http://127.0.0.1:4173/api/model-catalog",
    method: "GET",
    status: 200,
    headers: {},
  };
  for (const patch of [
    { method: "PUT" },
    { method: "POST" },
    { url: "https://outside.example/api/model-catalog" },
    { url: "http://secret:secret@127.0.0.1:4173/api/model-catalog" },
    { url: "http://127.0.0.1:4173/api/model-catalog/private-account" },
  ])
    diagnostics.observe({ ...valid, ...patch });
  assert.equal(diagnostics.snapshot().totalResponses, 0);
});

test("auth-status observations identify a quota-blocked reload without retaining account or URL data", () => {
  const diagnostics = createConnectionSaveDiagnostics("http://127.0.0.1:4173");
  diagnostics.observe({
    url: "http://127.0.0.1:4173/api/auth/status?account=secret",
    method: "GET",
    status: 429,
    headers: {
      "ratelimit-limit": "300",
      "ratelimit-remaining": "0",
      "ratelimit-reset": "5",
      "retry-after": "5",
      authorization: "Bearer secret",
    },
  });
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.totalResponses, 1);
  assert.deepEqual(snapshot.responses[0], {
    resource: "auth-status",
    atMs: snapshot.responses[0]?.atMs,
    method: "GET",
    status: 429,
    limit: 300,
    remaining: 0,
    resetSeconds: 5,
    retryAfterSeconds: 5,
  });
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /secret|account|127\.0\.0\.1|authorization|cookie/u,
  );
  diagnostics.observe({
    url: "http://127.0.0.1:4173/api/auth/status",
    method: "POST",
    status: 200,
    headers: {},
  });
  assert.equal(diagnostics.snapshot().totalResponses, 1);
});

for (const resource of ["agents", "tasks"] as const) {
  test(`${resource} observations expose a quota-blocked workspace read without retaining query or result data`, () => {
    const diagnostics = createConnectionSaveDiagnostics(
      "http://127.0.0.1:4173",
    );
    const url = `http://127.0.0.1:4173/api/${resource}?brief=secret`;
    diagnostics.observe({
      url,
      method: "GET",
      status: 429,
      headers: {
        "ratelimit-limit": "300",
        "ratelimit-remaining": "0",
        "ratelimit-reset": "5",
        "retry-after": "5",
        authorization: "Bearer secret",
      },
    });
    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.totalResponses, 1);
    assert.equal(snapshot.responses[0]?.resource, resource);
    assert.equal(snapshot.responses[0]?.status, 429);
    assert.equal(snapshot.responses[0]?.remaining, 0);
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /secret|brief|127\.0\.0\.1|authorization|cookie/u,
    );
    for (const patch of [
      { method: "POST" },
      { url: url.replace(`/api/${resource}`, `/api/${resource}/1`) },
      { url: url.replace("127.0.0.1", "outside.example") },
    ])
      diagnostics.observe({
        url,
        method: "GET",
        status: 200,
        headers: {},
        ...patch,
      });
    assert.equal(diagnostics.snapshot().totalResponses, 1);
  });
}
