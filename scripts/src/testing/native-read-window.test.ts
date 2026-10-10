import assert from "node:assert/strict";
import test from "node:test";
import { waitForNativeReadWindow } from "./native-read-window";
test("abundant real-header read budget does not schedule a wait", async () => {
  assert.deepEqual(
    await waitForNativeReadWindow(
      new Headers({
        "RateLimit-Limit": "300",
        "RateLimit-Remaining": "299",
        "RateLimit-Reset": "60",
      }),
    ),
    { limit: 300, remaining: 299, resetSeconds: 60, waitedMilliseconds: 0 },
  );
});
test("missing, malformed and out-of-scope read windows cannot authorize native acceptance", async () => {
  const valid = {
    "RateLimit-Limit": "300",
    "RateLimit-Remaining": "299",
    "RateLimit-Reset": "60",
  };
  for (const headers of [
    {},
    { ...valid, "RateLimit-Limit": "999" },
    { ...valid, "RateLimit-Remaining": "301" },
    { ...valid, "RateLimit-Remaining": "-1" },
    { ...valid, "RateLimit-Remaining": "250x" },
    { ...valid, "RateLimit-Reset": "0" },
    { ...valid, "RateLimit-Reset": "61" },
    { ...valid, "RateLimit-Reset": "1.5" },
  ])
    await assert.rejects(waitForNativeReadWindow(new Headers(headers)));
});
