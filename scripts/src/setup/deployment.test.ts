import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildContainerDeployment, buildNativeDeployment } from "./deployment";
import { planInstallation } from "./plan";
import type { InstallationResources } from "./resources";

const source = path.resolve("source with spaces");
const directory = path.resolve("private installation");
const resources: InstallationResources = {
  directory,
  secretFiles: {
    database_url: path.join(directory, "secrets/database_url"),
    operator_auth_token: path.join(directory, "secrets/operator_auth_token"),
    runtime_control_key: path.join(directory, "secrets/runtime_control_key"),
    postgres_password: path.join(directory, "secrets/postgres_password"),
    provider_key: path.join(directory, "secrets/provider_key"),
  },
};

test("prebuilt installation pulls an immutable image without compiling source", () => {
  const image = `ghcr.io/halittayyar0/agentic-company-os@sha256:${"a".repeat(64)}`;
  const deployment = buildContainerDeployment(
    source,
    plan("container"),
    resources,
    {},
    undefined,
    image,
  );
  assert.ok(deployment.args.includes("--no-build"));
  assert.ok(!deployment.args.includes("--build"));
  assert.equal(deployment.override.services.app.image, image);
  assert.equal(deployment.override.services["worker-1"].image, image);
  assert.throws(() =>
    buildContainerDeployment(
      source,
      plan("container"),
      resources,
      {},
      undefined,
      "ghcr.io/example/app:latest",
    ),
  );
});
function plan(mode: string, provider = "later") {
  return planInstallation(
    {
      mode,
      locale: "en",
      port: 54321,
      accessMode: "approval",
      provider,
      phoneAccess: "local",
      toolPacks: [],
    },
    {
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.20.0",
      postgresClientVersion: null,
      composeVersion: "2.40.0",
      native: { ready: true, issues: [] },
      container: { ready: true, issues: [] },
    },
  );
}

test("native launch has one API and two workers with separate writable data", () => {
  const specs = buildNativeDeployment(source, plan("native"), resources, {});
  assert.deepEqual(
    specs.map((spec) => spec.name),
    ["app", "worker-1", "worker-2"],
  );
  assert.ok(
    specs.every(
      (spec) => spec.cwd === directory && spec.command === process.execPath,
    ),
  );
  assert.equal(specs[0].env?.HOST, "127.0.0.1");
  assert.equal(specs[0].env?.SERVE_STATIC_UI, "true");
  assert.equal(
    specs[0].env?.OPERATOR_AUTH_TOKEN_FILE,
    resources.secretFiles.operator_auth_token,
  );
  assert.equal(specs[1].env?.OPERATOR_AUTH_TOKEN_FILE, undefined);
  assert.equal(
    specs[1].env?.RUNTIME_CONTROL_API_URL,
    "http://127.0.0.1:54321/api/internal/runtime-control",
  );
  assert.ok(
    specs.every(
      (spec) =>
        spec.env?.WORKSPACE_ENV_FILE === path.join(directory, "runtime.env"),
    ),
  );
});

test("provider configuration uses secret files and container-local addresses", () => {
  const native = buildNativeDeployment(
    source,
    plan("native", "openai"),
    resources,
    {},
  );
  assert.equal(
    native[1].env?.OPENAI_API_KEY_FILE,
    resources.secretFiles.provider_key,
  );
  assert.equal(native[1].env?.OPENAI_API_KEY, undefined);
  const docker = buildContainerDeployment(
    source,
    plan("container", "ollama"),
    resources,
    { ollamaUrl: "http://127.0.0.1:11434/v1" },
  );
  assert.equal(
    docker.override.services["worker-1"].environment.OLLAMA_BASE_URL,
    "http://host.docker.internal:11434/v1",
  );
  assert.deepEqual(docker.args.slice(-4), [
    "up",
    "--detach",
    "--build",
    "--remove-orphans",
  ]);
  assert.ok(!docker.args.includes("--wait"));
  assert.equal(docker.environment.APP_PORT, "54321");
  assert.equal(
    docker.override.secrets.database_url.file,
    resources.secretFiles.database_url,
  );
});

test("deployment descriptors reject a source-relative instance and credentials in local model URLs", () => {
  assert.throws(
    () =>
      buildNativeDeployment(
        source,
        plan("native"),
        { ...resources, directory: path.join(source, "data") },
        {},
      ),
    /outside/,
  );
  assert.throws(
    () =>
      buildContainerDeployment(source, plan("container", "ollama"), resources, {
        ollamaUrl: "https://user:secret@example.com/v1",
      }),
    /ollama/,
  );
});
