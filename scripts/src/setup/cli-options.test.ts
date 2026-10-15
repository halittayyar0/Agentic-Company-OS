import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  parseSetupArguments,
  setupHelp,
  SetupArgumentError,
} from "./cli-options";

test("setup accepts read-only help and check without installation paths", () => {
  assert.equal(parseSetupArguments(["--help"]).help, true);
  assert.equal(parseSetupArguments(["-h"]).help, true);
  assert.equal(parseSetupArguments(["--", "--check"]).check, true);
  assert.match(setupHelp, /--check/);
  assert.match(setupHelp, /bootstrap\.mjs/);
});

test("setup rejects ambiguous diagnostics and retains private arguments", () => {
  for (const args of [
    ["--check", "--resume", "private-secret"],
    ["--help", "--data-dir", "private-secret"],
    ["--help", "--check"],
    ["--check", "--check"],
    ["--resume"],
    ["--unknown=private-secret"],
    ["--resume", "one", "--resume", "two"],
    ["--data-dir", "one", "--resume", "two"],
  ]) {
    assert.throws(
      () => parseSetupArguments(args),
      (error: unknown) => {
        assert.ok(error instanceof SetupArgumentError);
        assert.doesNotMatch(error.message, /private-secret/);
        return true;
      },
    );
  }
  assert.equal(
    parseSetupArguments(["--resume", "relative"]).resume,
    path.resolve("relative"),
  );
  assert.equal(
    parseSetupArguments(["--data-dir", "relative"]).parent,
    path.resolve("relative"),
  );
});
