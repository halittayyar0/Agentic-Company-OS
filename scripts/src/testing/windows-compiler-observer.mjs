// Diagnostic preload only. Emits fixed compiler metadata, never command,
// path, environment, compiler output, or human credential information.
import { createRequire, syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import path from "node:path";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
const processTools = require("node:child_process");
const original = processTools.execFile;
const originalPromise = promisify(original);
const compilerCall = (args) => {
  const options = args[2];
  return (
    process.platform === "win32" &&
    typeof args[0] === "string" &&
    path.resolve(args[0]).toLowerCase() ===
      path
        .join(
          process.env.SystemRoot ?? "",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
        .toLowerCase() &&
    typeof options?.env?.ACOS_JOB_SOURCE === "string" &&
    typeof options?.env?.ACOS_JOB_BINARY === "string"
  );
};
function metadata(error, elapsedMs) {
  const code = error?.code;
  const codeClass =
    typeof code === "number" &&
    Number.isSafeInteger(code) &&
    code >= 0 &&
    code <= 255
      ? code
      : [
            "ENOENT",
            "EACCES",
            "EPERM",
            "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          ].includes(code)
        ? code
        : error
          ? "OTHER"
          : "NONE";
  const signal = ["SIGTERM", "SIGKILL", "SIGABRT"].includes(error?.signal)
    ? error.signal
    : error?.signal
      ? "OTHER"
      : "NONE";
  return {
    kind: "owned_windows_compiler_diagnostic",
    stage: "compiler_exit",
    elapsedMs: Math.round(elapsedMs),
    success: !error,
    killed: error?.killed === true,
    codeClass,
    signal,
  };
}
function observed(...args) {
  if (!compilerCall(args) || typeof args.at(-1) !== "function")
    return Reflect.apply(original, this, args);
  const callback = args.at(-1),
    start = performance.now();
  process.stderr.write(
    JSON.stringify({
      kind: "owned_windows_compiler_diagnostic",
      stage: "compiler_start",
      timeoutMs: args[2]?.timeout,
    }) + "\n",
  );
  args[args.length - 1] = (error, stdout, stderr) => {
    process.stderr.write(
      JSON.stringify(metadata(error, performance.now() - start)) + "\n",
    );
    callback(error, stdout, stderr);
  };
  return Reflect.apply(original, this, args);
}
Object.defineProperty(observed, promisify.custom, {
  value: function (...args) {
    if (!compilerCall(args)) return Reflect.apply(originalPromise, this, args);
    let child;
    const promise = new Promise((resolve, reject) => {
      child = observed(...args, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else resolve({ stdout, stderr });
      });
    });
    promise.child = child;
    return promise;
  },
});
processTools.execFile = observed;
syncBuiltinESMExports();
