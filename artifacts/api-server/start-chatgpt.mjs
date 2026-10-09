import { loadWorkspaceEnv } from "./load-workspace-env.mjs";
import { loadSecretEnvironment } from "./load-secret-env.mjs";

const args = process.argv.slice(2);
const helpOnly =
  args.length === 0 ||
  (args.length === 1 && ["help", "--help", "-h"].includes(args[0]));
if (!helpOnly) {
  loadWorkspaceEnv();
  loadSecretEnvironment(["DATABASE_URL", "RUNTIME_CONTROL_KEY"]);
}
await import("./dist/connect-chatgpt.mjs");
