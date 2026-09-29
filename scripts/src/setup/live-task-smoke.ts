import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNativeInstallSmoke } from "./native-install-smoke";

// Explicit, opt-in integration proof. Only a :free model is allowed. The
// temporary installation owns its database and retains private evidence.
const [postgresBin, pnpmPath, configPath, modelId] = process.argv.slice(2);
if (!postgresBin || !pnpmPath || !configPath || !modelId?.endsWith(":free"))
  throw new Error(
    "Supply PostgreSQL bin, pnpm JS, existing private provider config and a :free model ID",
  );
const settings = JSON.parse(await readFile(configPath, "utf8"));
if (typeof settings.openrouterApiKey !== "string" || !settings.openrouterApiKey)
  throw new Error("Provider credential missing");
const catalog = (await (
  await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(25000),
  })
).json()) as {
  data: Array<{
    id: string;
    pricing: { prompt: string; completion: string };
    supported_parameters: string[];
  }>;
};
const model = catalog.data.find((item) => item.id === modelId);
if (
  !model ||
  Number(model.pricing.prompt) !== 0 ||
  Number(model.pricing.completion) !== 0 ||
  !model.supported_parameters.includes("tools")
)
  throw new Error("Selected model is not currently free and tool-capable");
const directory = await runNativeInstallSmoke(postgresBin, pnpmPath, {
  providerKey: settings.openrouterApiKey,
  run: async ({ baseUrl, operatorToken, directory }) => {
    const request = async (route: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${baseUrl}/api${route}`, {
        method,
        signal: AbortSignal.timeout(20000),
        headers: {
          authorization: `Bearer ${operatorToken}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error(
          `Acceptance API ${method} ${route}: ${response.status}`,
        );
      return response.json();
    };
    const agents = (await request("/agents")) as Array<{
      id: number;
      parentAgentId: number | null;
    }>;
    const owner = agents.find((a) => a.parentAgentId === null);
    assert.ok(owner);
    await request(`/agents/${owner.id}`, "PATCH", {
      modelMode: "manual",
      modelId,
    });
    const create = async (autonomyMode: "finite" | "continuous") =>
      request("/tasks", "POST", {
        title: `Live ${autonomyMode} arithmetic proof`,
        brief:
          "Use the calculate tool to calculate 17 * 23. Verify the answer is 391. Then call complete_task with a concise result containing 391. Do not create agents, delegate, browse, write files or contact anyone. For a recurring task, do exactly this once per scheduled cycle and complete the cycle.",
        ownerAgentId: owner.id,
        priority: "normal",
        autonomyMode,
        ...(autonomyMode === "continuous" ? { cadenceSeconds: 60 } : {}),
      });
    const results: unknown[] = [];
    for (const mode of ["finite", "continuous"] as const) {
      const task = (await create(mode)) as { id: number };
      const deadline = Date.now() + 180000;
      process.stdout.write(`Live ${mode} task created: ${task.id}\n`);
      let previous = "";
      let done = false;
      try {
        while (Date.now() < deadline) {
          const state = (await request(`/tasks/${task.id}`)) as {
            status: string;
            cycleCount: number;
            resultSummary: string | null;
            lastModelId: string | null;
            modelFallbackCount: number;
            tokensUsed: number;
            estimatedCostUsd: string | null;
          };
          const progress = JSON.stringify({
            status: state.status,
            cycle: state.cycleCount,
            tokens: state.tokensUsed,
            model: state.lastModelId,
          });
          if (progress !== previous) {
            process.stdout.write(`${progress}\n`);
            previous = progress;
          }
          if (
            (mode === "finite" && state.status === "completed") ||
            (mode === "continuous" && state.cycleCount >= 2)
          ) {
            assert.match(state.resultSummary ?? "", /391/);
            assert.equal(state.lastModelId?.endsWith(":free"), true);
            assert.notEqual(
              state.estimatedCostUsd,
              null,
              "Provider cost must be reported, not inferred",
            );
            assert.equal(Number(state.estimatedCostUsd), 0);
            results.push({ mode, taskId: task.id, ...state });
            done = true;
            break;
          }
          if (["blocked", "failed", "cancelled"].includes(state.status))
            throw new Error(`Live task ${task.id} ended ${state.status}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        assert.equal(
          done,
          true,
          `Live ${mode} task did not finish before its deadline`,
        );
      } finally {
        await writeFile(
          path.join(directory, `live-${mode}-evidence.json`),
          JSON.stringify(
            {
              modelId,
              passed: done,
              verifiedAt: new Date().toISOString(),
              state: await request(`/tasks/${task.id}`),
              activity: await request(`/tasks/${task.id}/activity`),
            },
            null,
            2,
          ),
        );
        if (mode === "continuous" || !done)
          await request(`/tasks/${task.id}/cancel`, "POST", {});
      }
    }
    await writeFile(
      path.join(directory, "live-task-evidence.json"),
      JSON.stringify(
        { modelId, verifiedAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
    process.stdout.write("Live finite task and two recurring cycles passed.\n");
  },
});
process.stdout.write(`Evidence: ${directory}\n`);
