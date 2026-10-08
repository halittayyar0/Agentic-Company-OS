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
    "CHATGPT_STORAGE_DIRECTORY",
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

/** One owned, empty store per suite invocation. Default provider discovery must
 * never load or refresh a developer's renewable ChatGPT credentials. */
export async function prepareLocalTestEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  assertLocalTestEnvironment(environment);
  const canonicalTemp = await realpath(tmpdir());
  const directory = await mkdtemp(
    path.join(canonicalTemp, "acos-general-test-chatgpt-"),
  );
  return {
    ...environment,
    ALLOW_AGENT_CODEX_TASKS: "false",
    ACOS_CODEX_EXECUTABLE: undefined,
    TEMP: canonicalTemp,
    TMP: canonicalTemp,
    TMPDIR: canonicalTemp,
    CHATGPT_STORAGE_DIRECTORY: directory,
  };
}
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
