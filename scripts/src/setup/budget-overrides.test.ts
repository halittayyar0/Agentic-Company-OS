import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
  link,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseBudgetOverrides,
  readInstallationBudgetOverrides,
} from "./budget-overrides";
test("private budget overrides retain positive limits without inheriting execution or secret settings", () => {
  assert.deepEqual(
    parseBudgetOverrides(
      "# Limits\nMAX_TASK_TOKENS='120000'\nMAX_TASK_FAMILY_REPORTED_COST_USD=4.5 # explicit cap\nMAX_RECURRING_FAMILY_DAILY_TOKENS=1e6\nOPERATOR_AUTH_TOKEN=fixture-not-inherited\nENABLE_PROCESS_EXECUTION=true\n",
    ),
    {
      MAX_TASK_TOKENS: "120000",
      MAX_TASK_FAMILY_REPORTED_COST_USD: "4.5",
      MAX_RECURRING_FAMILY_DAILY_TOKENS: "1000000",
    },
  );
});
test("invalid or duplicate limits cannot silently fall back after restart", () => {
  for (const value of [
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "1e100",
    "${FIXTURE}",
    "0x20",
    "",
  ]) {
    assert.throws(
      () => parseBudgetOverrides(`MAX_TASK_TOKENS=${value}`),
      /MAX_TASK_TOKENS/,
    );
  }
  assert.throws(
    () => parseBudgetOverrides("MAX_TASK_TOKENS=10\nMAX_TASK_TOKENS=20"),
    /duplicate/,
  );
  assert.throws(
    () => parseBudgetOverrides("MAX_TASK_FAMILY_REPORTED_COST_USD=-1"),
    /MAX_TASK_FAMILY_REPORTED_COST_USD/,
  );
});
test("the documented zero step cap remains disabled after restart", () => {
  assert.deepEqual(parseBudgetOverrides("MAX_TASK_STEPS=0\n"), {
    MAX_TASK_STEPS: "0",
  });
  for (const key of ["MAX_TASK_TOKENS", "MAX_TASK_FAMILY_REPORTED_COST_USD"]) {
    assert.throws(() => parseBudgetOverrides(`${key}=0`));
  }
});
test("missing config is allowed while oversized and linked private configs are preserved and rejected", async (t) => {
  const directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-budget-config-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await readInstallationBudgetOverrides(directory), {});
  const file = path.join(directory, "compose.env");
  await writeFile(file, "x".repeat(64001));
  await assert.rejects(
    readInstallationBudgetOverrides(directory),
    /Invalid private/,
  );
  await writeFile(file, "MAX_TASK_TOKENS=120000\n");
  await link(file, path.join(directory, "linked.env"));
  await assert.rejects(
    readInstallationBudgetOverrides(directory),
    /Invalid private/,
  );
  assert.equal(await readFile(file, "utf8"), "MAX_TASK_TOKENS=120000\n");
});
