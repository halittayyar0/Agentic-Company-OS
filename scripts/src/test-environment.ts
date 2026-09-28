export function assertLocalTestEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  // The general suite imports database-owning modules during discovery in its
  // child processes. Those imports automatically migrate DATABASE_URL. Stop
  // before spawning them; never print credentials, file paths or URL values.
  const conflicts = [
    "DATABASE_URL",
    "DATABASE_URL_FILE",
    "DATABASE_MIGRATIONS_DIR",
    "POSTGRES_RACE_TEST_DISPOSABLE",
    "POSTGRES_RACE_TEST_FAIL_IF_SKIPPED",
  ].filter(
    (name) => environment[name] !== undefined && environment[name] !== "",
  );
  if (environment.NODE_ENV === "production") conflicts.push("NODE_ENV");
  if (environment.RUNTIME_ROLE && environment.RUNTIME_ROLE !== "combined") {
    conflicts.push("RUNTIME_ROLE");
  }
  if (conflicts.length > 0) {
    throw new Error(
      `General tests require a clean development shell for disposable, process-lifetime PGlite. Unset ${conflicts.join(", ")} in this shell before running pnpm test or pnpm run verify. Use the separately documented disposable PostgreSQL checks for native database proof. No tests were started.`,
    );
  }
}
