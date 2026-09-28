import assert from "node:assert/strict";
import test from "node:test";
import { errors } from "playwright-core";
import {
  BrowserActionOutcomeUnknownError,
  isBrowserActionOutcomeUnknownError,
  runAtMostOnceBrowserEffect,
} from "./browser";

test("an error at the browser effect boundary is typed as outcome unknown and never retried", async () => {
  const cause = new errors.TimeoutError("synthetic timeout after dispatch");
  let calls = 0;

  await assert.rejects(
    runAtMostOnceBrowserEffect(async () => {
      calls += 1;
      throw cause;
    }),
    (error: unknown) => {
      assert.equal(isBrowserActionOutcomeUnknownError(error), true);
      assert.ok(error instanceof BrowserActionOutcomeUnknownError);
      assert.equal(error.cause, cause);
      return true;
    },
  );
  assert.equal(calls, 1);
});
