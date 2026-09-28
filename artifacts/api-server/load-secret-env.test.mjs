import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSecretEnvironment } from "./load-secret-env.mjs";

test("loads an absolute one-line secret file without logging its value", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentic-os-secret-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secretPath = path.join(directory, "operator-token");
  fs.writeFileSync(secretPath, "secret-value\n", { mode: 0o600 });
  const environment = { OPERATOR_AUTH_TOKEN_FILE: secretPath };
  loadSecretEnvironment(["OPERATOR_AUTH_TOKEN"], environment);
  assert.equal(environment.OPERATOR_AUTH_TOKEN, "secret-value");
});

test("rejects ambiguous, relative, multiline, and oversized secret sources", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentic-os-secret-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const multiline = path.join(directory, "multiline");
  fs.writeFileSync(multiline, "one\ntwo\n");
  const oversized = path.join(directory, "oversized");
  fs.writeFileSync(oversized, "x".repeat(64 * 1024 + 1));

  assert.throws(
    () =>
      loadSecretEnvironment(["TOKEN"], {
        TOKEN: "direct",
        TOKEN_FILE: multiline,
      }),
    /cannot both be set/,
  );
  assert.throws(
    () => loadSecretEnvironment(["TOKEN"], { TOKEN_FILE: "relative" }),
    /absolute path/,
  );
  assert.throws(
    () => loadSecretEnvironment(["TOKEN"], { TOKEN_FILE: multiline }),
    /exactly one non-empty line/,
  );
  assert.throws(
    () => loadSecretEnvironment(["TOKEN"], { TOKEN_FILE: oversized }),
    /up to 64 KiB/,
  );
});
