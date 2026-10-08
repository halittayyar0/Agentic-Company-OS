import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildCodexTaskConfiguration,
  codexTaskConfigurationMatches,
} from "./codex-task-configuration";

const root = path.resolve("owned-fixture"),
  home = path.join(root, "private-home"),
  cwd = path.join(root, "workspace");
const input = {
  cwd,
  home,
  executable: process.execPath,
  model: "fixture-model",
  policy: { mode: "approval" as const },
  canUseTerminal: true,
  processExecEnabled: true,
};
function response(built: ReturnType<typeof buildCodexTaskConfiguration>) {
  return {
    config: structuredClone(built.values),
    layers: [
      {
        name: {
          type: "user",
          file: path.join(home, "config.toml"),
          profile: null,
        },
        config: structuredClone(built.values),
        disabledReason: null,
      },
      {
        name: { type: "system", file: path.join(root, "system.toml") },
        config: {},
        disabledReason: null,
      },
    ],
  };
}
test("owned Codex config isolates the provider credential from commands and retains the current execution policy", () => {
  const built = buildCodexTaskConfiguration(input);
  assert.equal(built.approvalPolicy, "on-request");
  assert.deepEqual(built.permissions.definition, {
    filesystem: {
      ":minimal": "read",
      ":workspace_roots": "read",
      [home]: "deny",
      [process.execPath]: "read",
    },
    network: { enabled: false },
  });
  assert.deepEqual(built.values.shell_environment_policy, {
    inherit: "none",
    experimental_use_profile: false,
  });
  assert.equal(built.values.allow_login_shell, false);
  assert.deepEqual(built.values.agents, { enabled: false });
  assert.equal(built.values.web_search, "disabled");
  const provider = (
    built.values.model_providers as Record<string, Record<string, unknown>>
  ).openai_chatgpt_plan;
  assert.equal(provider.base_url, "https://api.openai.com/v1");
  assert.equal(provider.env_key, "ACOS_CODEX_ACCESS_TOKEN");
  assert.equal(provider.request_max_retries, 0);
  assert.equal(provider.stream_max_retries, 0);
  assert.equal(built.toml.includes('"ACOS_CODEX_ACCESS_TOKEN"'), true);
  assert.equal(built.toml.includes('"inherit" = "none"'), true);
  assert.equal(
    codexTaskConfigurationMatches(
      response(built),
      built.permissions.configuration,
    ),
    true,
  );
});

test("verified managed Linux configuration fixes command helper selection without inheriting credentials", () => {
  const built = buildCodexTaskConfiguration({ ...input, managedLinux: true });
  assert.deepEqual(built.values.shell_environment_policy, {
    inherit: "none",
    set: { PATH: "/opt/agentic-inner:/usr/bin:/bin" },
    experimental_use_profile: false,
  });
  const actual = response(built);
  (actual.config.shell_environment_policy as Record<string, unknown>).set = {
    PATH: "/usr/bin:/bin",
  };
  assert.equal(
    codexTaskConfigurationMatches(actual, built.permissions.configuration!),
    false,
  );
});
test("full/custom access grants only workspace file writes and keeps command networking and extra agents disabled", () => {
  for (const policy of [
    { mode: "full_access" as const },
    { mode: "custom" as const, custom: { files: true, terminal: true } },
  ]) {
    const built = buildCodexTaskConfiguration({ ...input, policy });
    assert.equal(built.approvalPolicy, "never");
    assert.equal(
      (built.permissions.definition.filesystem as Record<string, string>)[
        ":workspace_roots"
      ],
      "write",
    );
    assert.deepEqual(built.permissions.definition.network, { enabled: false });
    assert.equal(
      (built.values.features as Record<string, boolean>).multi_agent,
      false,
    );
  }
  const readonly = buildCodexTaskConfiguration({
    ...input,
    policy: { mode: "custom", custom: { files: false, terminal: true } },
  });
  assert.equal(
    (readonly.permissions.definition.filesystem as Record<string, string>)[
      ":workspace_roots"
    ],
    "read",
  );
  assert.equal(readonly.approvalPolicy, "never");
});
test("disabled process execution, forbidden terminal, read-only policy and overlapping/noncanonical paths reject configuration", () => {
  for (const patch of [
    { processExecEnabled: false },
    { canUseTerminal: false },
    { policy: { mode: "read_only" as const } },
    {
      policy: {
        mode: "custom" as const,
        custom: { files: true, terminal: false },
      },
    },
    {
      policy: { mode: "custom" as const, custom: { terminal: true } as never },
    },
    { home: cwd },
    { home: path.dirname(cwd) },
    { home: path.join(cwd, "private") },
    { cwd: "relative" },
    { executable: "relative" },
    { executable: process.execPath + "*" },
    { executable: path.join(home, "codex") },
    { executable: path.join(cwd, "codex") },
    { model: "fixture\0model" },
  ])
    assert.throws(() => buildCodexTaskConfiguration({ ...input, ...patch }), {
      message: "codex_configuration_unsupported",
    });
});
test("foreign active config layers and effective provider/policy/environment amendments cannot pass owned config preflight", () => {
  const built = buildCodexTaskConfiguration(input);
  for (const change of [
    (value: ReturnType<typeof response>) => {
      value.layers.push({
        name: { type: "project", file: path.join(cwd, ".codex/config.toml") },
        config: { hooks: { command: "foreign" } },
        disabledReason: null,
      } as never);
    },
    (value: ReturnType<typeof response>) => {
      value.config.shell_environment_policy = { inherit: "all" };
    },
    (value: ReturnType<typeof response>) => {
      value.config.model_provider = "foreign_provider";
    },
    (value: ReturnType<typeof response>) => {
      value.config.mcp_servers = { foreign: { command: "foreign" } };
    },
    (value: ReturnType<typeof response>) => {
      value.config.hooks = { command: "foreign" };
    },
    (value: ReturnType<typeof response>) => {
      value.layers[0].name.file = path.join(root, "human-home/config.toml");
    },
  ]) {
    const value = response(built);
    change(value);
    assert.equal(
      codexTaskConfigurationMatches(value, built.permissions.configuration),
      false,
    );
  }
  const disabled = response(built);
  disabled.layers.push({
    name: { type: "project", file: "fixture" },
    config: { hooks: "foreign" },
    disabledReason: "untrusted project",
  } as never);
  assert.equal(
    codexTaskConfigurationMatches(disabled, built.permissions.configuration),
    true,
  );
});
