import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionSaveDiagnostics } from "./connection-save-diagnostics";

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
