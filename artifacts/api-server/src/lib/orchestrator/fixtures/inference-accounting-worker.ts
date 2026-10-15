import assert from "node:assert/strict";
import type { createChatCompletion } from "@workspace/ai-server";

async function main() {
  // This helper is test-only. Validate the disposable target before importing
  // any database-owning module, which would otherwise run migrations.
  assert.equal(process.env.POSTGRES_RACE_TEST_DISPOSABLE, "1");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(
    ["agentic_os_ci", "agentic_inference_test"].includes(
      target.pathname.slice(1),
    ),
  );
  const [mode, agentValue, taskValue] = process.argv.slice(2);
  const agentId = Number(agentValue),
    taskId = Number(taskValue);
  assert.ok(Number.isSafeInteger(agentId) && agentId > 0);
  assert.ok(Number.isSafeInteger(taskId) && taskId > 0);
  assert.ok(
    ["park", "park-reserved", "park-evidenced", "complete"].includes(mode),
  );
  const { dbReady, closeDatabase } = await import("@workspace/db");
  const { runAccountedCompletion, InferenceAccountingError } =
    await import("../inference-accounting");
  await dbReady;
  let calls = 0;
  const runner: typeof createChatCompletion = async (params) => {
    if (mode === "park-reserved") {
      process.send?.({ kind: "reserved", calls });
      await new Promise<void>((resolve) =>
        process.once("message", () => resolve()),
      );
    }
    await params.beforeRequest?.();
    calls++;
    if (mode === "park") {
      process.send?.({ kind: "dispatched", calls });
      // Parent kills only this owned fixture process after the durable dispatch.
      await new Promise<void>(() => {});
    }
    if (mode === "park-evidenced") {
      await params.onResponseUsage?.({
        provider: "openrouter",
        model: params.model,
        responseId: "owned-offline-fixture",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      process.send?.({ kind: "evidenced", calls });
      await new Promise<void>((resolve) =>
        process.once("message", () => resolve()),
      );
    }
    return {
      provider: "openrouter",
      completion: {
        id: "owned-offline-fixture",
        object: "chat.completion",
        created: 1,
        model: params.model,
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    };
  };
  let result;
  try {
    await runAccountedCompletion(
      {
        agentId,
        taskId,
        modelId: "fixture",
        provider: "openrouter",
        kind: "chat",
      },
      { model: "fixture", messages: [] },
      runner,
    );
    result = { kind: "result", calls, accountingStatus: null };
  } catch (error) {
    if (!(error instanceof InferenceAccountingError)) throw error;
    result = {
      kind: "result",
      calls,
      reason: error.reason,
      accountingStatus: error.accountingStatus,
    };
  }
  await closeDatabase();
  await new Promise<void>((resolve, reject) =>
    process.send?.(result, (error) => (error ? reject(error) : resolve())),
  );
  process.disconnect?.();
}
main().catch(() => {
  process.exitCode = 1;
  process.disconnect?.();
});
