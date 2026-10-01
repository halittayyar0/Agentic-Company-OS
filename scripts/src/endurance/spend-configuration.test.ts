import assert from "node:assert/strict";
import test from "node:test";
import { createEnduranceSpendConfiguration } from "./spend-configuration";

test("endurance provenance contains only the nine selected numerical spend caps", () => {
  const selected = createEnduranceSpendConfiguration({
    MAX_RECURRING_FAMILY_DAILY_TOKENS: " 2.5e6 ",
    MAX_TASK_STEPS: "0",
    MAX_TASK_REPORTED_COST_USD: "0.125",
    OPENAI_API_KEY: "private-value",
    OPERATOR_AUTH_TOKEN: "private-value",
  });
  assert.equal(
    selected.environment.MAX_RECURRING_FAMILY_DAILY_TOKENS,
    "2500000",
  );
  assert.equal(selected.provenance.MAX_RECURRING_FAMILY_DAILY_TOKENS, 2500000);
  assert.equal(selected.provenance.MAX_TASK_STEPS, 0);
  assert.equal(selected.provenance.MAX_TASK_REPORTED_COST_USD, 0.125);
  assert.equal(Object.keys(selected.provenance).length, 9);
  assert.equal(JSON.stringify(selected).includes("private-value"), false);
  assert.deepEqual(
    Object.keys(selected.environment),
    Object.keys(selected.provenance),
  );
  for (const [key, value] of Object.entries(selected.provenance)) {
    assert.equal(
      selected.environment[key as keyof typeof selected.environment],
      String(value),
    );
  }
});

for (const value of [
  "",
  " ",
  "0",
  "-1",
  "1.5",
  "NaN",
  "Infinity",
  "9007199254740992",
  "private-value",
]) {
  test(`invalid endurance token cap fails closed (${JSON.stringify(value)})`, () => {
    assert.throws(
      () => createEnduranceSpendConfiguration({ MAX_TASK_TOKENS: value }),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message === "Invalid endurance spend setting: MAX_TASK_TOKENS",
    );
  });
}

test("zero disables only the step cap, never a token or reported-cost limit", () => {
  assert.equal(
    createEnduranceSpendConfiguration({ MAX_TASK_STEPS: "0" }).provenance
      .MAX_TASK_STEPS,
    0,
  );
  assert.throws(
    () =>
      createEnduranceSpendConfiguration({ MAX_TASK_REPORTED_COST_USD: "0" }),
    /MAX_TASK_REPORTED_COST_USD/,
  );
  assert.throws(
    () => createEnduranceSpendConfiguration({ MAX_TASK_STEPS: "-1" }),
    /MAX_TASK_STEPS/,
  );
});

test("startup-invalid task limits are rejected during endurance selection", () => {
  assert.throws(
    () => createEnduranceSpendConfiguration({ MAX_TASK_STEPS: "10001" }),
    /MAX_TASK_STEPS/,
  );
  for (const tokens of ["1", "999", "100000001"]) {
    assert.throws(
      () => createEnduranceSpendConfiguration({ MAX_TASK_TOKENS: tokens }),
      /MAX_TASK_TOKENS/,
    );
  }
});

test("endurance selection accepts the production startup boundaries", () => {
  for (const tokens of ["1000", "100000000"]) {
    assert.equal(
      createEnduranceSpendConfiguration({ MAX_TASK_TOKENS: tokens }).environment
        .MAX_TASK_TOKENS,
      tokens,
    );
  }
  assert.equal(
    createEnduranceSpendConfiguration({ MAX_TASK_STEPS: "10000" }).environment
      .MAX_TASK_STEPS,
    "10000",
  );
});
