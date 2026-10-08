import path from "node:path";
import type { PreparedCodexTask } from "./codex-task-adapter";

type Policy = {
  mode: "read_only" | "approval" | "full_access" | "custom";
  custom?: { files: boolean; terminal: boolean } | null;
};
interface Input {
  cwd: string;
  home: string;
  /** Canonical backend-verified CLI file, outside the writable workspace/home. */
  executable: string;
  model: string;
  policy: Policy;
  canUseTerminal: boolean;
  processExecEnabled: boolean;
}
export interface CodexOwnedConfiguration {
  file: string;
  values: Record<string, unknown>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
function disjoint(left: string, right: string) {
  return [path.relative(left, right), path.relative(right, left)].every(
    (relative) =>
      relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
  );
}
function toml(values: Record<string, unknown>): string {
  const lines: string[] = [];
  function table(value: Record<string, unknown>, keys: string[]) {
    if (keys.length)
      lines.push(`[${keys.map((key) => JSON.stringify(key)).join(".")}]`);
    for (const [key, item] of Object.entries(value))
      if (!record(item))
        lines.push(`${JSON.stringify(key)} = ${JSON.stringify(item)}`);
    for (const [key, item] of Object.entries(value))
      if (record(item)) table(item, [...keys, key]);
  }
  table(values, []);
  return `${lines.join("\n")}\n`;
}

/** Backend inputs only. This maps the existing policy to a bounded coding
 * capability; it grants no additional agents, browser, networking or sudo.
 * A native process still needs effective-config and OS-containment preflight. */
export function buildCodexTaskConfiguration(input: Input) {
  if (
    !input.processExecEnabled ||
    !input.canUseTerminal ||
    input.policy.mode === "read_only" ||
    !["approval", "full_access", "custom"].includes(input.policy.mode) ||
    (input.policy.mode === "custom" &&
      (input.policy.custom?.terminal !== true ||
        typeof input.policy.custom.files !== "boolean")) ||
    !text(input.model) ||
    ![input.cwd, input.home, input.executable].every(
      (value) =>
        text(value) &&
        path.isAbsolute(value) &&
        path.normalize(value) === value,
    ) ||
    !disjoint(input.cwd, input.home) ||
    !disjoint(input.executable, input.cwd) ||
    !disjoint(input.executable, input.home) ||
    /[*?\[\]]/u.test(input.executable)
  )
    throw new Error("codex_configuration_unsupported");
  // The pinned binary still advertises "untrusted" in its schema but rejects
  // it at startup. Approval mode keeps the workspace read-only: effectful
  // patches require an exact-action approval; unsandboxed commands are refused.
  const approvalPolicy =
    input.policy.mode === "approval"
      ? ("on-request" as const)
      : ("never" as const);
  const write =
    input.policy.mode === "full_access" ||
    (input.policy.mode === "custom" && input.policy.custom?.files === true);
  const definition = {
    filesystem: {
      ":minimal": "read",
      ":workspace_roots": write ? "write" : "read",
      [input.home]: "deny",
      // The native Linux helper re-executes this exact verified CLI inside its
      // restricted filesystem. A user installation outside :minimal needs an
      // explicit file read; its containing directory gets no extra grant.
      [input.executable]: "read",
    },
    network: { enabled: false },
  };
  const values: Record<string, unknown> = {
    model: input.model,
    model_provider: "openai_chatgpt_plan",
    default_permissions: "acos_task",
    approval_policy: approvalPolicy,
    approvals_reviewer: "user",
    cli_auth_credentials_store: "ephemeral",
    web_search: "disabled",
    allow_login_shell: false,
    allow_symlinked_codex_home: false,
    check_for_update_on_startup: false,
    file_opener: "none",
    model_providers: {
      openai_chatgpt_plan: {
        name: "ChatGPT plan",
        base_url: "https://api.openai.com/v1",
        env_key: "ACOS_CODEX_ACCESS_TOKEN",
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false,
        supports_standalone_web_search: false,
        request_max_retries: 0,
        stream_max_retries: 0,
      },
    },
    permissions: { acos_task: definition },
    // The app-server alone receives the credential. Commands cannot inherit it.
    shell_environment_policy: {
      inherit: "none",
      set: { PATH: "/opt/agentic-inner:/usr/bin:/bin" },
      experimental_use_profile: false,
    },
    analytics: { enabled: false },
    agents: { enabled: false },
    mcp_servers: {},
    // Keep project trust unset in this fresh owned home. On pinned 0.159.2,
    // an explicit "untrusted" project can replace the named filesystem policy
    // with a legacy read-only policy: the native private-sentinel probe caught
    // a read through the intended home denial. Default untrusted project layers
    // remain disabled; the driver must verify their effective layer state and
    // let unsupported named containment refuse the thread before inference.
    apps: { _default: { enabled: false } },
    skills: { bundled: { enabled: false }, include_instructions: false },
    features: Object.fromEntries(
      [
        "plugins",
        "recommended_plugins",
        "hooks",
        "codex_hooks",
        "plugin_hooks",
        "multi_agent",
        "multi_agent_v2",
        "apps",
        "browser_use",
        "computer_use",
        "remote_plugin",
        "remote_control",
        "auth_elicitation",
        "memory_tool",
        "memories",
        "tool_search",
        "tool_suggest",
        "request_permissions",
        "request_permissions_tool",
      ].map((key) => [key, false]),
    ),
    otel: {
      exporter: "none",
      metrics_exporter: "none",
      trace_exporter: "none",
      log_user_prompt: false,
    },
  };
  const configuration = { file: path.join(input.home, "config.toml"), values };
  const permissions: NonNullable<PreparedCodexTask["permissions"]> = {
    id: "acos_task",
    definition,
    runtimeWorkspaceRoots: [input.cwd],
    runtimeExecutable: input.executable,
    configuration,
  };
  return { values, toml: toml(values), approvalPolicy, permissions };
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item != null)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalized(item)]),
    );
  return value;
}
function same(left: unknown, right: unknown) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}
function includes(actual: unknown, expected: unknown): boolean {
  if (!record(expected)) return same(actual, expected);
  if (!record(actual)) return false;
  if (Object.keys(expected).length === 0)
    return Object.keys(actual).length === 0;
  return Object.entries(expected).every(([key, value]) =>
    includes(actual[key], value),
  );
}
/** Rejects inherited active project/human/system configuration rather than
 * assuming an empty override removes it. Disabled project layers are inert. */
export function codexTaskConfigurationMatches(
  response: unknown,
  expected: CodexOwnedConfiguration,
): boolean {
  if (
    !record(response) ||
    !record(response.config) ||
    !Array.isArray(response.layers) ||
    response.layers.length > 32 ||
    !includes(response.config, expected.values) ||
    (response.config.hooks != null && !same(response.config.hooks, {}))
  )
    return false;
  let ownedLayers = 0;
  for (const layer of response.layers) {
    if (!record(layer) || !record(layer.name) || !record(layer.config))
      return false;
    if (
      typeof layer.disabledReason === "string" &&
      layer.disabledReason.length > 0
    )
      continue;
    if (
      layer.name.type === "user" &&
      layer.name.file === expected.file &&
      layer.name.profile == null
    ) {
      if (!same(layer.config, expected.values)) return false;
      ownedLayers++;
    } else if (Object.keys(layer.config).length > 0) return false;
  }
  return ownedLayers === 1;
}
