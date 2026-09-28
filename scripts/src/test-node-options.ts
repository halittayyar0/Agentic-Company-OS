// Workers inherit execArgv but can start after a test changes process.cwd().
// A bare "tsx" would then resolve from the temporary directory and crash
// the worker. Resolve once against this workspace before launching tests.
export const testLoaderUrl = import.meta.resolve("tsx");
