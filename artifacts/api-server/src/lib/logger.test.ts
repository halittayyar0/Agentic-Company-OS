import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorForLog } from "./logger";

test("safe error logging drops SDK request/config/header objects", () => {
  const error = Object.assign(
    new Error(
      "POST https://provider.test/v1/chat?token=query-secret failed: Authorization: Bearer live-secret-token",
    ),
    {
      code: "ETIMEDOUT",
      status: 502,
      config: {
        headers: { Authorization: "Bearer live-secret-token" },
        apiKey: "live-secret-token",
      },
      response: { body: "private provider response" },
    },
  );

  const serialized = safeErrorForLog(error);
  const durable = JSON.stringify(serialized);
  assert.equal(serialized.code, "ETIMEDOUT");
  assert.equal(serialized.status, 502);
  assert.doesNotMatch(durable, /live-secret-token|private provider response/);
  assert.doesNotMatch(durable, /config|headers|response|stack/);
  assert.match(durable, /\[REDACTED\]/);
});
