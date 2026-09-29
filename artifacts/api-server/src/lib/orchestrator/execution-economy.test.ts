import assert from "node:assert/strict";
import test from "node:test";
import { executionComplexity } from "./execution-economy";

test("a new task starts economically even when its owner is the CEO", () => {
  assert.equal(
    executionComplexity({
      stepAttempts: 1,
      consecutiveFailures: 0,
      progressPercent: 0,
    }),
    "normal",
  );
});

test("sustained work or repeated failures can use a stronger execution tier", () => {
  assert.equal(
    executionComplexity({
      stepAttempts: 4,
      consecutiveFailures: 0,
      progressPercent: 10,
    }),
    "high",
  );
  assert.equal(
    executionComplexity({
      stepAttempts: 2,
      consecutiveFailures: 2,
      progressPercent: 0,
    }),
    "high",
  );
  assert.equal(
    executionComplexity({
      stepAttempts: 20,
      consecutiveFailures: 0,
      progressPercent: 95,
    }),
    "normal",
  );
});

test("recurring lifetime attempts do not permanently upgrade every later cycle", () => {
  assert.equal(
    executionComplexity({
      autonomyMode: "continuous",
      stepAttempts: 1000,
      consecutiveFailures: 0,
      progressPercent: 0,
    }),
    "normal",
  );
});
