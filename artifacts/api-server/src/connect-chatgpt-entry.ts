import { runChatGPTConnectionCLI } from "./lib/chatgpt-cli";

const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());
process.exitCode = await runChatGPTConnectionCLI(process.argv.slice(2), {
  signal: abort.signal,
});
