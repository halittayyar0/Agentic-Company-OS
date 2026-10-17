import type { InstallCapabilities, PreflightIssue } from "./preflight";

const remedies: Record<
  | PreflightIssue
  | "coding_linux_engine_required"
  | "coding_compose_version_required"
  | "coding_x64_engine_required"
  | "coding_apparmor_required"
  | "coding_distribution_missing",
  string
> = {
  native_source_required:
    "Native installation requires a source checkout; this portable bundle uses Docker.",
  container_distribution_required:
    "This self-contained package runs directly. The separate advanced Docker package is available on the release page.",
  unsupported_platform: "Use Windows, macOS or Linux.",
  unsupported_architecture: "Use an x64 or ARM64 computer.",
  node_24_required:
    "Install Node.js 24 and run this command with that version.",
  docker_unavailable:
    "Install Docker with the Compose v2 plugin, then start its Linux engine.",
  docker_engine_unavailable:
    "Start Docker and check that this account can access its engine.",
  docker_linux_engine_required: "Switch Docker to its Linux container engine.",
  compose_v2_required: "Install or enable Docker Compose v2.",
  coding_linux_engine_required:
    "Resolve the container prerequisites before enabling coding workers.",
  coding_compose_version_required:
    "Optional coding workers require Compose 2.24.4 or newer in the v2 series.",
  coding_x64_engine_required:
    "Optional coding workers require a Linux x64 Docker engine.",
  coding_apparmor_required:
    "Optional coding workers require engine AppArmor support and the dedicated host profile.",
  coding_distribution_missing:
    "This bundle has no coding image; use a release that includes one for coding workers.",
};

export function setupCheckReport(state: InstallCapabilities): {
  text: string;
  exitCode: number;
} {
  const section = (
    name: string,
    capability: { ready: boolean; issues: readonly string[] },
  ) => [
    `${name}: ${capability.ready ? "prerequisites available" : "not ready"}`,
    ...capability.issues.map(
      (issue) =>
        `  - ${Object.hasOwn(remedies, issue) ? remedies[issue as keyof typeof remedies] : "Review the installation guide for this prerequisite."}`,
    ),
  ];
  return {
    exitCode: state.native.ready || state.container.ready ? 0 : 1,
    text: [
      "Agentic Company OS prerequisite check",
      ...section("Container", state.container),
      ...section(
        state.native.managedDatabase
          ? "Included native runtime"
          : "Native source",
        state.native,
      ),
      state.native.managedDatabase
        ? "  Node and PostgreSQL are included. No Docker, Git, pnpm, external database or source compilation is needed."
        : "  Native setup also requires an existing PostgreSQL database and the source toolchain (pnpm 10.17.1).",
      ...section(
        "Optional coding engine",
        state.coding ?? { ready: false, issues: [] },
      ),
      "  Coding also requires the dedicated host AppArmor profile; engine readiness does not verify that profile.",
      `Private phone network: ${state.phone?.ready ? "Tailscale connection detected; HTTPS setup still required" : "not detected; connect Tailscale to configure private HTTPS phone access"}`,
      "No installation or model request was started. Readiness is a prerequisite check, not a completed installation or model test.",
      "Next: start setup without --check, or follow docs/self-hosting.md and docs/mobile-access.md in the repository.",
      "",
    ].join("\n"),
  };
}
