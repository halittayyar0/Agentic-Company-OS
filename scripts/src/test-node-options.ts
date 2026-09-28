import { canonicalTempRoot } from "./temp-directory";

// Workers inherit execArgv but can start after a test changes process.cwd().
// A bare "tsx" would then resolve from the temporary directory and crash
// the worker. Resolve once against this workspace before launching tests.
export const testLoaderUrl = import.meta.resolve("tsx");

// Windows runners may provide an 8.3 alias; macOS commonly provides /var.
// Normalize the trusted OS default before tests create guarded directories.
const tempRoot = canonicalTempRoot();
if (process.platform === "win32") {
  process.env.TEMP = tempRoot;
  process.env.TMP = tempRoot;
} else {
  process.env.TMPDIR = tempRoot;
}
