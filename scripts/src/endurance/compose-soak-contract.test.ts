import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

test("soak compose uses an attested image and one read-only run-scoped control mount", async () => {
  const [dockerfile, baseCompose, compose] = await Promise.all([
    readFile(path.join(workspaceRoot, "Dockerfile"), "utf8"),
    readFile(path.join(workspaceRoot, "compose.yaml"), "utf8"),
    readFile(path.join(workspaceRoot, "compose.soak.yaml"), "utf8"),
  ]);

  assert.match(
    dockerfile,
    /FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build/u,
  );
  assert.equal(
    (
      dockerfile.match(
        /node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    baseCompose,
    /postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0/u,
  );
  assert.match(dockerfile, /FROM runtime AS endurance-runtime/u);
  assert.match(dockerfile, /\/app\/\.agentic-endurance-runtime/u);
  assert.match(dockerfile, /ARG ENDURANCE_SOURCE_COMMIT_SHA/u);
  assert.match(dockerfile, /ARG ENDURANCE_SOURCE_TREE_SHA256/u);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/u);
  assert.match(dockerfile, /com\.agentic-company-os\.source-tree-sha256/u);
  assert.match(
    dockerfile.trimEnd(),
    /FROM runtime AS production-runtime$/u,
    "an ordinary unqualified docker build must end on the non-attested target",
  );
  assert.doesNotMatch(compose, /ENDURANCE_MODE:\s*wall_clock/u);
  assert.equal((compose.match(/ENDURANCE_MODE:\s*soak/gu) ?? []).length, 3);
  assert.equal(
    (compose.match(/target:\s*endurance-runtime/gu) ?? []).length,
    3,
  );
  assert.equal(
    (compose.match(/image:\s*\$\{ENDURANCE_RUNTIME_IMAGE:\?[^}]*\}/gu) ?? [])
      .length,
    3,
  );
  assert.equal(
    (
      compose.match(
        /\$\{ENDURANCE_CONTROL_DIR_HOST:\?[^}]*\}:\/app\/endurance-control:ro/gu,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(
    (compose.match(/ENDURANCE_RUN_DIR:\s*\/app\/endurance-control/gu) ?? [])
      .length,
    3,
  );
  assert.equal(
    (
      compose.match(
        /SYNTHETIC_RUNTIME_CONTROL_FILE:\s*\/app\/endurance-control\/fault-control\.json/gu,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(
    (compose.match(/RUNTIME_HEARTBEAT_MS:\s*"1000"/gu) ?? []).length,
    3,
  );
  assert.equal(
    (compose.match(/WORKER_STALE_AFTER_MS:\s*"5000"/gu) ?? []).length,
    3,
    "the short worker fault must exceed the soak-only stale threshold",
  );
});

test("soak compose replaces every ordinary secret with a required run-scoped file", async () => {
  const compose = await readFile(
    path.join(workspaceRoot, "compose.soak.yaml"),
    "utf8",
  );
  for (const variable of [
    "ENDURANCE_DATABASE_URL_SECRET_FILE",
    "ENDURANCE_OPERATOR_TOKEN_SECRET_FILE",
    "ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE",
    "ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE",
  ]) {
    assert.match(compose, new RegExp(`\\$\\{${variable}:\\?[^}]*\\}`, "u"));
  }
});

test("container CI proves the synthetic image boundary and reuses the real short soak verifier", async () => {
  const workflow = await readFile(
    path.join(workspaceRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /docker build[\s\S]*?--target endurance-runtime[\s\S]*?--build-arg ENDURANCE_SOURCE_COMMIT_SHA="\$GITHUB_SHA"[\s\S]*?--build-arg ENDURANCE_SOURCE_TREE_SHA256="\$\{\{ steps\.source-identity\.outputs\.source-tree-sha256 \}\}"[\s\S]*?--tag agentic-company-os:endurance-ci/u,
  );
  assert.match(workflow, /ENDURANCE_PREBUILT_IMAGE:\s*"true"/u);
  assert.match(
    workflow,
    /ENDURANCE_RUNTIME_IMAGE:\s*agentic-company-os:endurance-ci/u,
  );
  assert.match(workflow, /ordinary production image rejects synthetic mode/iu);
  assert.match(
    workflow,
    /Synthetic runtime is forbidden in production without the dedicated endurance image attestation/iu,
  );
  assert.match(
    workflow,
    /pnpm endurance:wall-clock --[\s\S]*?--duration-hours 0\.16666666666666666[\s\S]*?--fault-profile compressed-all/u,
  );
  assert.match(
    workflow,
    /pnpm endurance:verify-report --[\s\S]*?--expect-mode wall_clock[\s\S]*?--expect-commit "\$GITHUB_SHA"[\s\S]*?--expect-runtime docker-compose[\s\S]*?--allow-unverified-duration/u,
  );
});

test("Windows CI verifies a SHA256-pinned PostgreSQL 17 artifact and runs native smoke plus verifier", async () => {
  const workflow = await readFile(
    path.join(workspaceRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const windowsJob = workflow.match(
    /windows-runtime:[\s\S]*?(?=\n  [a-z][a-z0-9-]+:|$)/u,
  )?.[0];
  assert.ok(windowsJob);
  assert.match(windowsJob, /postgresql-17\.10-1-windows-x64-binaries\.zip/u);
  assert.match(
    windowsJob,
    /f9aafca58e7026a1ef2caeee711acf761671e57904d430adc85f468374f5a821/u,
  );
  assert.match(windowsJob, /Get-FileHash[^\n]*SHA256/u);
  assert.match(
    windowsJob,
    /Get-Item[^\n]*\$archive[^\n]*\.Length[\s\S]*?333925750/u,
  );
  assert.match(windowsJob, /endurance:native-postgres-smoke/u);
  assert.match(
    windowsJob,
    /endurance:wall-clock:native[\s\S]*?--duration-hours 0\.03333333333333333[\s\S]*?--fault-profile compressed-all/u,
  );
  assert.match(
    windowsJob,
    /endurance:verify-report[\s\S]*?--expect-runtime native-postgres[\s\S]*?--allow-unverified-duration/u,
  );
});
