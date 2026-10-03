import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Execute the same built entry shipped to native/container installations.
// No importing API implementation into this script's TypeScript project.
const entry = fileURLToPath(
  new URL("../../artifacts/api-server/start-chatgpt.mjs", import.meta.url),
);
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  shell: false,
  windowsHide: true,
  stdio: "inherit",
});
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
child.once("error", () => {
  process.stderr.write(
    "Could not start the connection tool. Build the application first.\n",
  );
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
