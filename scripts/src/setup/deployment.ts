import path from "node:path";
import type { ManagedProcessSpec } from "../endurance/process-supervisor";
import type { InstallationPlan } from "./plan";
import type { InstallationResources } from "./resources";
import type { InstallationCredentials } from "./session";

function validateRoots(source: string, resources: InstallationResources) {
  if (!path.isAbsolute(source) || !path.isAbsolute(resources.directory))
    throw new Error("Installation paths must be absolute");
  const relative = path.relative(source, resources.directory);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new Error("Installation data must be outside the source checkout");
}

function modelUrl(value: string | undefined, container: boolean): string {
  const url = new URL(value ?? "http://127.0.0.1:11434/v1");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("ollama_url_invalid");
  if (container && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    url.hostname = "host.docker.internal";
  return url.href.replace(/\/$/u, "");
}

function commonEnvironment(
  plan: InstallationPlan,
  resources: InstallationResources,
  credentials: InstallationCredentials,
  phoneUrl?: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(plan.settings.port),
    WORKSPACE_ENV_FILE: path.join(resources.directory, "runtime.env"),
    DATABASE_URL: undefined,
    DATABASE_URL_FILE: resources.secretFiles.database_url,
    RUNTIME_CONTROL_KEY: undefined,
    RUNTIME_CONTROL_KEY_FILE: resources.secretFiles.runtime_control_key,
    OPERATOR_AUTH_TOKEN: undefined,
    OPERATOR_AUTH_TOKEN_FILE: undefined,
    OPENAI_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined,
    AI_INTEGRATIONS_OPENAI_API_KEY: undefined,
    AI_INTEGRATIONS_OPENAI_API_KEY_FILE: undefined,
    AI_INTEGRATIONS_OPENAI_BASE_URL: undefined,
    OPENAI_API_KEY_FILE: undefined,
    OPENROUTER_API_KEY_FILE: undefined,
    OLLAMA_BASE_URL: undefined,
    SYNTHETIC_RUNTIME_ENABLED: undefined,
    ENDURANCE_MODE: undefined,
    ENDURANCE_RUN_ID: undefined,
    ALLOW_AGENT_CODEX_TASKS: "false",
    ACOS_CODEX_EXECUTABLE: undefined,
    ALLOW_REMOTE_ACCESS: "false",
    ALLOW_AGENT_PROCESS_EXEC:
      plan.settings.accessMode === "read_only" ? "false" : "true",
    ALLOW_AGENT_SUDO: "false",
    ALLOW_FOUNDER_SHELL: "false",
    AGENT_SANDBOX_ROOT: path.join(resources.directory, "agent-sandboxes"),
    AGENT_BROWSER_HEADLESS: "true",
    TRUSTED_HOSTS: "localhost,127.0.0.1",
    CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${plan.settings.port}`,
  };
  if (plan.settings.provider === "openai")
    environment.OPENAI_API_KEY_FILE = resources.secretFiles.provider_key;
  if (plan.settings.provider === "openrouter")
    environment.OPENROUTER_API_KEY_FILE = resources.secretFiles.provider_key;
  if (plan.settings.provider === "ollama")
    environment.OLLAMA_BASE_URL = modelUrl(credentials.ollamaUrl, false);
  if (phoneUrl) {
    const url = new URL(phoneUrl);
    environment.TRUSTED_HOSTS += `,${url.hostname}`;
    environment.CORS_ALLOWED_ORIGINS += `,${url.origin}`;
  }
  return environment;
}

export function buildNativeDeployment(
  source: string,
  plan: InstallationPlan,
  resources: InstallationResources,
  credentials: InstallationCredentials,
  phoneUrl?: string,
): ManagedProcessSpec[] {
  validateRoots(source, resources);
  if (plan.settings.mode !== "native")
    throw new Error("Native deployment requires native mode");
  const common = commonEnvironment(plan, resources, credentials, phoneUrl);
  return [
    {
      name: "app",
      command: process.execPath,
      args: [
        "--enable-source-maps",
        path.join(source, "artifacts/api-server/start.mjs"),
      ],
      cwd: resources.directory,
      env: {
        ...common,
        RUNTIME_ROLE: "api",
        SCHEDULER_ENABLED: "false",
        OPERATOR_AUTH_TOKEN_FILE: resources.secretFiles.operator_auth_token,
        ALLOW_REMOTE_ACCESS: phoneUrl ? "true" : "false",
        SERVE_STATIC_UI: "true",
        STATIC_UI_DIR: path.join(
          source,
          "artifacts/agentic-company-os/dist/public",
        ),
      },
    },
    ...["worker-1", "worker-2"].map((name) => ({
      name,
      command: process.execPath,
      args: [
        "--enable-source-maps",
        path.join(source, "artifacts/api-server/start-worker.mjs"),
      ],
      cwd: resources.directory,
      env: {
        ...common,
        RUNTIME_ROLE: "worker",
        SCHEDULER_ENABLED: "true",
        SERVE_STATIC_UI: "false",
        RUNTIME_CONTROL_API_URL: `http://127.0.0.1:${plan.settings.port}/api/internal/runtime-control`,
      },
    })),
  ];
}

export function buildContainerDeployment(
  source: string,
  plan: InstallationPlan,
  resources: InstallationResources,
  credentials: InstallationCredentials,
  phoneUrl?: string,
  prebuiltImage?: string,
  coding?: { image?: string; apparmor: boolean },
) {
  validateRoots(source, resources);
  if (
    prebuiltImage &&
    !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u.test(
      prebuiltImage,
    )
  )
    throw new Error(
      "Prebuilt installation requires an immutable GHCR image digest",
    );
  if (plan.settings.mode !== "container")
    throw new Error("Container deployment requires container mode");
  if (
    plan.settings.codingRuntime &&
    (!coding ||
      coding.apparmor !== true ||
      (prebuiltImage && !coding.image) ||
      (coding.image &&
        (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u.test(
          coding.image,
        ) ||
          coding.image === prebuiltImage)))
  )
    throw new Error(
      "coding_runtime_requires_separate_immutable_image_and_host_policy",
    );
  const common: Record<string, string> = {
    ALLOW_AGENT_PROCESS_EXEC:
      plan.settings.accessMode === "read_only" ? "false" : "true",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    AI_INTEGRATIONS_OPENAI_API_KEY: "",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "",
    OLLAMA_BASE_URL: "",
  };
  if (plan.settings.provider === "ollama")
    common.OLLAMA_BASE_URL = modelUrl(credentials.ollamaUrl, true);
  if (plan.settings.provider === "openai")
    common.OPENAI_API_KEY_FILE = "/run/secrets/provider_key";
  if (plan.settings.provider === "openrouter")
    common.OPENROUTER_API_KEY_FILE = "/run/secrets/provider_key";
  const providerSecrets = resources.secretFiles.provider_key
    ? ["provider_key"]
    : [];
  const services: Record<
    string,
    { environment: Record<string, string>; secrets: string[]; image?: string }
  > = {};
  for (const name of ["app", "worker-1", "worker-2"])
    services[name] = {
      ...(prebuiltImage
        ? {
            image:
              name !== "app" && plan.settings.codingRuntime
                ? coding!.image
                : prebuiltImage,
          }
        : {}),
      environment: {
        ...common,
        ALLOW_AGENT_CODEX_TASKS:
          name !== "app" && plan.settings.codingRuntime ? "true" : "false",
        ...(name !== "app" && plan.settings.codingRuntime
          ? { ACOS_CODEX_EXECUTABLE: "/opt/agentic-codex/bin/codex" }
          : {}),
      },
      secrets: [
        "database_url",
        "runtime_control_key",
        ...(name === "app" ? ["operator_auth_token"] : []),
        ...providerSecrets,
      ],
    };
  const secrets: Record<string, { file: string }> = {};
  for (const [name, file] of Object.entries(resources.secretFiles))
    if (file) secrets[name] = { file };
  return {
    args: [
      "compose",
      "--project-name",
      `agentic-${plan.id}`,
      "--project-directory",
      source,
      "--env-file",
      path.join(resources.directory, "compose.env"),
      "--file",
      path.join(source, "compose.yaml"),
      ...(plan.settings.codingRuntime
        ? [
            "--file",
            path.join(source, "compose.coding.yaml"),
            ...(coding!.apparmor
              ? ["--file", path.join(source, "compose.coding-apparmor.yaml")]
              : []),
          ]
        : []),
      "--file",
      path.join(resources.directory, "compose.override.json"),
      "up",
      "--detach",
      ...(prebuiltImage ? ["--no-build", "--pull", "always"] : ["--build"]),
      "--remove-orphans",
    ],
    environment: {
      APP_PORT: String(plan.settings.port),
      AGENTIC_SECRET_GID: String(process.getgid?.() ?? 1000),
      TRUSTED_HOSTS:
        "localhost,127.0.0.1,app" +
        (phoneUrl ? `,${new URL(phoneUrl).hostname}` : ""),
      CORS_ALLOWED_ORIGINS:
        `http://127.0.0.1:${plan.settings.port}` +
        (phoneUrl ? `,${new URL(phoneUrl).origin}` : ""),
    },
    override: { services, secrets },
  };
}
