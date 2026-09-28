import { loadWorkspaceEnv } from "./load-workspace-env.mjs";
import { loadSecretEnvironment } from "./load-secret-env.mjs";

loadWorkspaceEnv();
loadSecretEnvironment([
  "DATABASE_URL",
  "OPERATOR_AUTH_TOKEN",
  "RUNTIME_CONTROL_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
]);

await import("./dist/index.mjs");
