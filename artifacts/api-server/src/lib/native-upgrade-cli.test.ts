import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import {
  parseNativeUpgradeArguments,
  runNativeUpgradeMigrationCLI,
} from "./native-upgrade-cli";

const id = "12345678-1234-1234-1234-123456789012";
test("migration-only CLI uses a closed argument protocol and never accepts credentials in arguments", () => {
  const valid = [
    "--staging-directory",
    process.cwd(),
    "--upgrade-id",
    id,
    "--target-commit",
    "b".repeat(40),
  ];
  assert.equal(parseNativeUpgradeArguments(valid).upgradeId, id);
  for (const args of [
    [],
    valid.slice(0, -2),
    [...valid, "--database-url", "secret"],
    [...valid, "--upgrade-id", id],
    [...valid.slice(0, 3), "bad", ...valid.slice(4)],
    [...valid.slice(0, 1), "relative", ...valid.slice(2)],
    [...valid.slice(0, -1), "main"],
  ])
    assert.throws(() => parseNativeUpgradeArguments(args));
});

test("invalid migration-only invocation has bounded safe output and never imports the application database", async () => {
  const messages: string[] = [];
  const result = await runNativeUpgradeMigrationCLI(
    ["--database-url", "private-credential"],
    {
      migrationsDirectory: process.cwd(),
      output: (value) => messages.push(value),
    },
  );
  assert.equal(result, 1);
  assert.equal(messages.length, 1);
  assert.doesNotMatch(
    messages[0],
    /private-credential|postgresql:|DATABASE_URL/u,
  );
});

test("packaged upgrade entrypoint cannot import API, scheduler, provider or agent runtime code", async () => {
  const entry = fileURLToPath(
    new URL("../native-upgrade-entry.ts", import.meta.url),
  );
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    external: ["@electric-sql/pglite", "pg-native"],
    logLevel: "silent",
  });
  const ownInputs = Object.keys(result.metafile!.inputs).filter(
    (file) => !file.replaceAll("\\", "/").includes("node_modules/"),
  );
  assert.ok(ownInputs.length > 5);
  for (const file of ownInputs)
    assert.match(
      file.replaceAll("\\", "/"),
      /(?:lib\/db\/src\/|lib\/ai-server\/src\/owner-private-storage\.ts$|artifacts\/api-server\/src\/(?:native-upgrade-entry\.ts|lib\/(?:native-upgrade-cli|native-upgrade-database|read-bounded-file)\.ts)$)/u,
      file,
    );
  assert.doesNotMatch(
    Object.keys(result.metafile!.inputs).join("\n"),
    /node_modules\/(?:openai|express|playwright)/u,
  );
});
