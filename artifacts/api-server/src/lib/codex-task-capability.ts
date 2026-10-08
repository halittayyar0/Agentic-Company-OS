import path from "node:path";

/** Configuration only. No executable probe, credential read, provider request,
 * native launch, filesystem containment claim or task permission is granted. */
export function codexTaskConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const executable = environment.ACOS_CODEX_EXECUTABLE;
  return (
    environment.ALLOW_AGENT_CODEX_TASKS === "true" &&
    environment.ALLOW_AGENT_PROCESS_EXEC === "true" &&
    environment.RUNTIME_ROLE !== "api" &&
    typeof executable === "string" &&
    executable.length <= 4096 &&
    path.isAbsolute(executable) &&
    path.normalize(executable) === executable &&
    !/[\u0000-\u001f\u007f]/u.test(executable)
  );
}

export function readCodexConfigurationReport(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Readonly<Record<string, boolean>> {
  const executable = environment.ACOS_CODEX_EXECUTABLE;
  return Object.freeze({
    codexConfigurationV1: true,
    codexOptIn: environment.ALLOW_AGENT_CODEX_TASKS === "true",
    codexNonApi: environment.RUNTIME_ROLE !== "api",
    codexProcessExecution: environment.ALLOW_AGENT_PROCESS_EXEC === "true",
    codexExecutableConfigured:
      typeof executable === "string" &&
      executable.length <= 4096 &&
      path.isAbsolute(executable) &&
      path.normalize(executable) === executable &&
      !/[\u0000-\u001f\u007f]/u.test(executable),
    // This is presence of an implemented lifetime controller, not proof that
    // this CLI/profile/OS can contain a coding task. Windows0.159.2 currently
    // refuses the required split-read profile in the tested environment.
    codexNativeController: platform === "win32" || platform === "linux",
  });
}

export type CodexConfigurationState =
  | "disabled"
  | "configuration_required"
  | "unsupported_platform"
  | "preflight_required"
  | "not_reported";
export function codexConfigurationStatus(
  report: Readonly<Record<string, boolean>>,
): CodexConfigurationState {
  const keys = [
    "codexConfigurationV1",
    "codexOptIn",
    "codexNonApi",
    "codexProcessExecution",
    "codexExecutableConfigured",
    "codexNativeController",
  ];
  if (
    report?.codexConfigurationV1 !== true ||
    keys.some((key) => typeof report[key] !== "boolean")
  )
    return "not_reported";
  if (!report.codexOptIn || !report.codexNonApi) return "disabled";
  if (!report.codexProcessExecution || !report.codexExecutableConfigured)
    return "configuration_required";
  if (!report.codexNativeController) return "unsupported_platform";
  return "preflight_required";
}

/** Tool advertisement uses current local configuration/platform; actual task
 * execution still requires every live authority and containment preflight. */
export function codexTaskMayBeOffered(): boolean {
  return (
    codexConfigurationStatus(readCodexConfigurationReport()) ===
    "preflight_required"
  );
}
