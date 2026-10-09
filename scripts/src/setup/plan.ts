import { randomUUID } from "node:crypto";
import type { InstallCapabilities } from "./preflight";

export const SETUP_LOCALES = [
  "tr",
  "en",
  "de",
  "ru",
  "zh-CN",
  "zh-TW",
  "ar",
] as const;
export const INSTALL_MODES = ["native", "container"] as const;
export const ACCESS_MODES = [
  "read_only",
  "approval",
  "full_access",
  "custom",
] as const;
export const PROVIDERS = ["later", "openai", "openrouter", "ollama"] as const;
export const TOOL_PACKS = [
  "data",
  "documents",
  "web",
  "code",
  "planning",
] as const;
export const PHONE_ACCESS = ["local", "private_network"] as const;

export interface InstallationInput {
  mode: (typeof INSTALL_MODES)[number];
  locale: (typeof SETUP_LOCALES)[number];
  port: number;
  accessMode: (typeof ACCESS_MODES)[number];
  provider: (typeof PROVIDERS)[number];
  phoneAccess: (typeof PHONE_ACCESS)[number];
  toolPacks: readonly (typeof TOOL_PACKS)[number][];
  codingRuntime?: boolean;
  customPermissions?: Readonly<{
    files: boolean;
    terminal: boolean;
    browser: boolean;
    delegation: boolean;
    sudo: boolean;
  }>;
}
export type InstallationStep =
  | "check_environment"
  | "prepare_private_config"
  | "connect_postgres"
  | "build_application"
  | "compose_up"
  | "start_native"
  | "apply_preferences"
  | "configure_phone"
  | "verify_runtime";

export interface InstallationPlan {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly settings: Readonly<InstallationInput>;
  readonly steps: readonly InstallationStep[];
}

function option<T extends string>(
  value: unknown,
  choices: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !choices.some((choice) => choice === value))
    throw new TypeError(`Invalid installation ${name}`);
  return value as T;
}

export function validateInstallationInput(value: unknown): InstallationInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Installation settings must be an object");
  const input = value as Record<string, unknown>;
  const keys = new Set([
    "mode",
    "locale",
    "port",
    "accessMode",
    "provider",
    "phoneAccess",
    "toolPacks",
    "customPermissions",
    "codingRuntime",
  ]);
  if (Object.keys(input).some((key) => !keys.has(key)))
    throw new TypeError("Unknown installation setting");
  if (
    input.codingRuntime !== undefined &&
    typeof input.codingRuntime !== "boolean"
  )
    throw new TypeError("Invalid coding runtime selection");
  if (
    typeof input.port !== "number" ||
    !Number.isInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65535
  )
    throw new TypeError("Installation port must be between 1024 and 65535");
  if (!Array.isArray(input.toolPacks) || input.toolPacks.length > 10)
    throw new TypeError("Invalid tool packs");
  let customPermissions: InstallationInput["customPermissions"];
  if (input.accessMode === "custom") {
    const custom = input.customPermissions ?? {
      files: false,
      terminal: false,
      browser: false,
      delegation: false,
      sudo: false,
    };
    const expected = ["files", "terminal", "browser", "delegation", "sudo"];
    if (
      !custom ||
      typeof custom !== "object" ||
      Array.isArray(custom) ||
      Object.keys(custom).length !== expected.length ||
      expected.some(
        (key) => typeof (custom as Record<string, unknown>)[key] !== "boolean",
      )
    )
      throw new TypeError("Invalid custom permissions");
    customPermissions = Object.freeze({
      ...custom,
    }) as InstallationInput["customPermissions"];
  } else if (input.customPermissions !== undefined)
    throw new TypeError("Unexpected custom permissions");
  return {
    mode: option(input.mode, INSTALL_MODES, "mode"),
    locale: option(input.locale, SETUP_LOCALES, "locale"),
    accessMode: option(input.accessMode, ACCESS_MODES, "access mode"),
    provider: option(input.provider, PROVIDERS, "provider"),
    phoneAccess: option(input.phoneAccess, PHONE_ACCESS, "phone access"),
    port: input.port,
    ...(input.codingRuntime !== undefined
      ? { codingRuntime: input.codingRuntime }
      : {}),
    ...(customPermissions ? { customPermissions } : {}),
    toolPacks: [
      ...new Set(
        input.toolPacks.map((entry) => option(entry, TOOL_PACKS, "tool pack")),
      ),
    ],
  };
}

export function planInstallation(
  value: unknown,
  capabilities: InstallCapabilities,
): InstallationPlan {
  const settings = validateInstallationInput(value);
  if (
    settings.codingRuntime &&
    (settings.mode !== "container" ||
      !capabilities.coding?.ready ||
      capabilities.coding.apparmor !== true ||
      settings.accessMode === "read_only" ||
      (settings.accessMode === "custom" &&
        settings.customPermissions?.terminal !== true))
  )
    throw new Error(
      `coding_runtime_unavailable: ${capabilities.coding?.issues.join(", ") || "container_and_terminal_permission_required"}`,
    );
  if (settings.phoneAccess === "private_network" && !capabilities.phone?.ready)
    throw new Error(
      "Private phone access requires a connected Tailscale installation",
    );
  const capability = capabilities[settings.mode];
  if (!capability.ready)
    throw new Error(
      `Installation prerequisites: ${capability.issues.join(", ")}`,
    );
  const steps: InstallationStep[] = [
    "check_environment",
    "prepare_private_config",
  ];
  if (settings.mode === "native")
    steps.push("connect_postgres", "build_application", "start_native");
  else steps.push("compose_up");
  steps.push("apply_preferences");
  if (settings.phoneAccess === "private_network") steps.push("configure_phone");
  steps.push("verify_runtime");
  return Object.freeze({
    id: randomUUID(),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: Object.freeze({
      ...settings,
      toolPacks: Object.freeze([...settings.toolPacks]),
    }),
    steps: Object.freeze(steps),
  });
}
