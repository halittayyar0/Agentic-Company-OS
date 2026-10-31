import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  derivePrivatePackageDriver,
  deriveControlledBaselineDriver,
} from "./derive.mjs";

const source = await readFile(
  new URL("../../scripts/src/setup/native-package-smoke.ts", import.meta.url),
  "utf8",
);

test("derive only the inspected application package driver; refuse source drift before instrumentation", () => {
  const derived = derivePrivatePackageDriver(source);
  assert.match(derived.outputSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    derived.inputSha256,
    "586478a9bbb1e80961a698c01800c0db3b22e57dc75f5597bad5f4dac9860af4",
  );
  assert.throws(
    () => derivePrivatePackageDriver(source + '\nconsole.log("unexpected");\n'),
    /inspected_native_driver_source_required/,
  );
  assert.throws(
    () => derivePrivatePackageDriver(source.replace("wx", "w")),
    /inspected_native_driver_source_required/,
  );
});

test("only a separately labelled controlled old published input excludes current runtime probes", () => {
  const result = deriveControlledBaselineDriver(source);
  assert.ok(
    result.source.includes("baseline_requires_controlled_simulated_peer_only"),
  );
  assert.ok(result.source.includes("proof.oldRuntimeUpgradeInputOnly = true"));
  assert.ok(
    result.source.includes(
      "6d8f6ab631f527d5cfc1e7c63c5584e3e6b4f89d7c38dc900cd291378193c80a",
    ),
  );
  assert.ok(result.source.includes("proof.nodeDnsSecurityRegression = false"));
  assert.ok(
    result.source.includes("proof.postgresCopySecurityRegression = false"),
  );
  const parsed = ts.transpileModule(result.source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
    },
  });
  assert.deepEqual(
    (parsed.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ),
    [],
  );
  assert.ok(
    derivePrivatePackageDriver(source).source.includes(
      "proof.nodeDnsSecurityRegression = true",
    ),
  );
});

test("derived actual driver preserves current security checks and emits no model prose or fixture paths to stdout", () => {
  const derived = derivePrivatePackageDriver(source);
  assert.ok(derived.source.includes("scripts/test-runtime-security.mjs"));
  assert.ok(derived.source.includes("runtime_security_missing"));
  assert.ok(derived.source.includes("runtime-security-sentinel=0"));
  assert.ok(
    derived.source.includes(
      "proof.privateFixture = { owned, packageRoot, parent, instance, appUrl }",
    ),
  );
  assert.ok(derived.source.includes("observeOwnedFirstTask"));
  assert.equal(
    derived.source.includes("console.log(JSON.stringify(proof))"),
    false,
  );
  assert.equal(derived.source.includes("live ? 20 * 60_000"), false);
  const parsed = ts.transpileModule(derived.source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
    },
  });
  assert.deepEqual(
    (parsed.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ),
    [],
  );
});
