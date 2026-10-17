const phases = ["idle", "planned", "installing", "complete", "failed"] as const;
const steps = [
  "check_environment",
  "prepare_private_config",
  "connect_postgres",
  "start_native",
  "apply_preferences",
  "verify_runtime",
] as const;

// Public acceptance receipts contain only this closed vocabulary. In
// particular, an HTTP error payload may include private URLs or credentials.
// Keep that payload out of the public receipt, including on a failed install.
export function publicNativeSetupState(state: Record<string, unknown>) {
  return {
    phase: phases.find((phase) => phase === state.phase) ?? "unknown",
    step: steps.find((step) => step === state.step) ?? null,
    completedSteps: steps.filter(
      (step) =>
        Array.isArray(state.completedSteps) &&
        state.completedSteps.includes(step),
    ),
    error: state.error == null ? null : "setup_failed",
  };
}
