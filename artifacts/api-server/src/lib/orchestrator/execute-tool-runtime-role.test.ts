import assert from "node:assert/strict";
import test from "node:test";
import { executeTool, type ToolRuntimeContext } from "./execute-tool";

test("split API fails browser tools closed before process-local state is touched", async () => {
  const hadRuntimeRole = Object.hasOwn(process.env, "RUNTIME_ROLE");
  const previousRuntimeRole = process.env.RUNTIME_ROLE;
  process.env.RUNTIME_ROLE = "api";

  try {
    for (const toolName of [
      "browser_open",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_extract_text",
      "browser_wait",
      "browser_save_screenshot",
    ]) {
      const result = await executeTool(
        {} as ToolRuntimeContext,
        toolName,
        "{}",
      );
      assert.equal(result.toolOutcome, "rejected");
      assert.match(result.content, /split API runtime/i);
    }
  } finally {
    if (hadRuntimeRole) process.env.RUNTIME_ROLE = previousRuntimeRole;
    else delete process.env.RUNTIME_ROLE;
  }
});
