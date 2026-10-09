import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { runNativeInstallSmoke } from "../setup/native-install-smoke";

// Explicit offline acceptance, not a model-quality test. The real installer owns
// a new PostgreSQL cluster, API and two workers. Only the model HTTP peer is fake.
if (process.env.ACOS_GUIDED_LOCAL_SMOKE !== "1")
  throw new Error("explicit_guided_local_smoke_required");
const [postgresBin, explicitPnpmPath] = process.argv.slice(2);
const pnpmPath = explicitPnpmPath ?? process.env.npm_execpath;
assert.ok(postgresBin && path.isAbsolute(postgresBin));
assert.ok(pnpmPath && path.isAbsolute(pnpmPath));
const source = fileURLToPath(new URL("../../..", import.meta.url));
for (const name of Object.keys(process.env))
  if (
    /^(DATABASE_|OPERATOR_AUTH_|RUNTIME_CONTROL_|OPENAI_|OPENROUTER_|AI_INTEGRATIONS_|REPLIT_OPENROUTER_|OLLAMA_|CHATGPT_|ACOS_CODEX_|AGENT_SANDBOX_|ALLOW_AGENT_CODEX_TASKS$|WORKSPACE_ENV_FILE$|SYNTHETIC_|ENDURANCE_)/u.test(
      name,
    ) &&
    process.env[name] &&
    name !== "ENDURANCE_POSTGRES_ROOT"
  )
    throw new Error("offline_fixture_requires_clean_environment");
async function sourceIdentity() {
  const run = promisify(execFile);
  const options = {
    cwd: source,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2_097_152,
  };
  const baseCommit = (
    await run("git", ["rev-parse", "HEAD"], options)
  ).stdout.trim();
  const files = (
    await run(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      options,
    )
  ).stdout
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file + "\0");
    hash.update(await readFile(path.join(source, file)));
  }
  return { baseCommit, workingSourceSha256: hash.digest("hex") };
}
const beforeSource = await sourceIdentity();
const locales = ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"];
const requests: { method: string; path: string; kind?: string }[] = [];
const unexpected: string[] = [];
const model = "acos-fixture:latest";
const peer = createServer(async (req, res) => {
  try {
    let bytes = 0;
    const parts: Buffer[] = [];
    for await (const part of req) {
      bytes += part.length;
      assert.ok(bytes <= 1_048_576);
      parts.push(part);
    }
    assert.ok(requests.length < 512);
    const route = req.url!,
      method = req.method!;
    const body = bytes ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {};
    res.setHeader("Content-Type", "application/json");
    if (route === "/api/tags" && method === "GET") {
      requests.push({ method, path: route });
      res.end(JSON.stringify({ models: [{ name: model, model }] }));
    } else if (route === "/api/show" && method === "POST") {
      assert.equal(body.model, model);
      requests.push({ method, path: route });
      res.end(
        JSON.stringify({
          capabilities: ["completion", "tools"],
          details: { parameter_size: "8B" },
        }),
      );
    } else if (route === "/v1/chat/completions" && method === "POST") {
      assert.equal(body.model, model);
      assert.notEqual(body.stream, true);
      const judge = body.response_format?.type === "json_object";
      const messages: Array<Record<string, unknown>> = body.messages;
      assert.ok(Array.isArray(messages));
      const calculated = messages.some(
        (message) =>
          Array.isArray(message.tool_calls) &&
          message.tool_calls.some(
            (call: { function?: { name?: string } }) =>
              call.function?.name === "calculate",
          ),
      );
      const toolName = calculated ? "complete_task" : "calculate";
      if (calculated && !judge)
        assert.ok(
          messages.some(
            (message) =>
              message.role === "tool" &&
              typeof message.content === "string" &&
              message.content.includes("391"),
          ),
        );
      if (!judge)
        assert.ok(
          body.tools.some(
            (tool: { function: { name: string } }) =>
              tool.function.name === toolName,
          ),
        );
      requests.push({ method, path: route, kind: judge ? "judge" : toolName });
      res.end(
        JSON.stringify({
          id: "fixture-" + randomUUID(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              finish_reason: judge ? "stop" : "tool_calls",
              message: judge
                ? {
                    role: "assistant",
                    content: JSON.stringify({
                      verdict: "pass",
                      reasoning:
                        "Offline fixture received the arithmetic tool result.",
                    }),
                  }
                : {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call-" + randomUUID(),
                        type: "function",
                        function: {
                          name: toolName,
                          arguments: JSON.stringify(
                            calculated
                              ? {
                                  resultSummary:
                                    "Offline arithmetic fixture: 17 × 23 = 391, calculated with the local tool.",
                                }
                              : { operation: "multiply", values: [17, 23] },
                          ),
                        },
                      },
                    ],
                  },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    } else {
      unexpected.push(`${method} ${route}`);
      res.statusCode = 404;
      res.end("{}");
    }
  } catch {
    unexpected.push("invalid_fixture_request");
    res.statusCode = 400;
    res.end("{}");
  }
});
peer.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => peer.once("listening", resolve));
const peerAddress = peer.address();
assert.ok(peerAddress && typeof peerAddress === "object");
const endpoint = `http://127.0.0.1:${peerAddress.port}`;
let evidenceDirectory: string | undefined;
try {
  evidenceDirectory = await runNativeInstallSmoke(postgresBin, pnpmPath, {
    kind: "offline-guided",
    run: async ({ baseUrl, operatorToken, directory }) => {
      const request = async <T = Record<string, unknown>>(
        route: string,
        method = "GET",
        body?: unknown,
      ): Promise<T> => {
        const send = () =>
          fetch(baseUrl + "/api" + route, {
            method,
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
            headers: {
              authorization: `Bearer ${operatorToken}`,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        let response = await send();
        // The fixture performs fourteen deliberate settings writes. A confirmed
        // pre-route 429 permits one retry after the real window, never an unknown
        // save outcome. Keep the production limit unchanged.
        if (response.status === 429) {
          const seconds = Number(response.headers.get("Retry-After"));
          assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 60);
          await response.body?.cancel();
          console.log("Offline fixture awaiting confirmed rate-limit window");
          await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
          response = await send();
        }
        assert.equal(
          response.ok,
          true,
          `${method} ${route}: ${response.status}`,
        );
        const value: unknown = await response.json();
        assert.ok(value && typeof value === "object");
        return value as T;
      };
      assert.equal((await fetch(baseUrl + "/api/tasks")).status, 401);
      const initialAgents = await request<Array<{ id: number }>>("/agents");
      const initialTasks = await request<Array<{ id: number }>>("/tasks");
      assert.equal(initialTasks.length, 0);
      const browser = await chromium.launch({ headless: true });
      const results: unknown[] = [];
      const copyRoot = path.join(
        source,
        "artifacts/agentic-company-os/src/lib",
      );
      const shell = await import(
        pathToFileURL(path.join(copyRoot, "i18n.ts")).href
      );
      const home = await import(
        pathToFileURL(path.join(copyRoot, "home-copy.ts")).href
      );
      const connection = await import(
        pathToFileURL(path.join(copyRoot, "connection-copy.ts")).href
      );
      try {
        for (const locale of locales) {
          const settings = await request("/settings/llm");
          await request("/settings/llm", "PUT", {
            expectedRevision: settings.revision,
            ollamaBaseUrl: null,
          });
          const beforeCalls = requests.filter((x) => x.kind).length;
          const beforeTasks = await request<Array<{ id: number }>>("/tasks");
          const h = await home.loadHomeCopy(locale),
            c = await connection.loadConnectionCopy(locale);
          const s = await shell.loadShellMessages(locale);
          const context = await browser.newContext({
            viewport: { width: locale === "ar" ? 320 : 390, height: 844 },
            reducedMotion: "reduce",
            extraHTTPHeaders: { authorization: `Bearer ${operatorToken}` },
          });
          await context.addInitScript(
            (value) => localStorage.setItem("acos.locale.v1", value),
            locale,
          );
          const page = await context.newPage();
          const pageErrors: string[] = [];
          page.on("pageerror", () => pageErrors.push("pageerror"));
          await page.route("**/*", (route) =>
            new URL(route.request().url()).origin === new URL(baseUrl).origin
              ? route.continue()
              : route.abort(),
          );
          const brief =
            "Use calculate for 17 × 23, report 391, then complete this one task. Do not delegate, create agents, browse or write files.";
          try {
            await page.goto(baseUrl);
            const draft = page.getByRole("textbox", {
              name: h.desiredOutcome,
              exact: true,
            });
            await expect(draft).toBeVisible();
            await draft.fill(brief);
            await page
              .getByRole("button", { name: s.providerSetupAction, exact: true })
              .click();
            let dialog = page.getByRole("dialog");
            await dialog
              .getByRole("button", { name: c.local, exact: true })
              .click();
            await page.keyboard.press("Escape");
            await expect(dialog).not.toBeVisible();
            await expect(draft).toHaveValue(brief);
            await page.reload();
            await expect(draft).toHaveValue(brief);
            await page
              .getByRole("button", { name: s.providerSetupAction, exact: true })
              .click();
            dialog = page.getByRole("dialog");
            await dialog
              .getByRole("button", { name: c.local, exact: true })
              .click();
            await dialog
              .getByRole("textbox", { name: c.endpoint, exact: true })
              .fill(endpoint);
            await dialog
              .getByRole("button", { name: c.save, exact: true })
              .click();
            await expect(dialog.getByRole("status")).toContainText(c.saved);
            assert.equal(requests.filter((x) => x.kind).length, beforeCalls);
            assert.equal(
              (await request<unknown[]>("/tasks")).length,
              beforeTasks.length,
            );
            const saved = await request<{
              ollama: { baseUrl: string; addressSource: string };
            }>("/settings/llm");
            assert.equal(saved.ollama.baseUrl, endpoint + "/v1");
            assert.equal(saved.ollama.addressSource, "runtime");
            await page.keyboard.press("Escape");
            await expect(draft).toHaveValue(brief);
            assert.equal(
              await page.evaluate(
                "document.documentElement.scrollWidth <= innerWidth",
              ),
              true,
            );
            assert.equal(
              await page.locator("html").getAttribute("dir"),
              locale === "ar" ? "rtl" : "ltr",
            );
            await page.screenshot({
              path: path.join(directory, `guided-${locale}.png`),
              fullPage: true,
            });
            await page
              .getByRole("button", { name: h.startProject, exact: true })
              .click();
            await expect(page).toHaveURL(/\/projects\/\d+$/, {
              timeout: 15_000,
            });
            const id = Number(new URL(page.url()).pathname.split("/").at(-1));
            assert.ok(Number.isSafeInteger(id) && id > 0);
            let task: Record<string, unknown> = {};
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
              task = await request(`/tasks/${id}`);
              if (task.status === "completed") break;
              assert.ok(
                !["failed", "blocked", "cancelled"].includes(
                  String(task.status),
                ),
                `task_${String(task.status)}`,
              );
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            assert.equal(task.status, "completed");
            assert.match(String(task.resultSummary), /391/);
            assert.equal(task.lastModelId, "ollama:" + model);
            assert.equal(task.modelFallbackCount, 0);
            assert.equal(
              (await request<unknown[]>("/agents")).length,
              initialAgents.length,
            );
            assert.equal(
              (await request<unknown[]>("/tasks")).length,
              beforeTasks.length + 1,
            );
            assert.deepEqual(
              requests
                .slice()
                .filter((x) => x.kind)
                .slice(beforeCalls)
                .map((x) => x.kind),
              ["calculate", "complete_task", "judge"],
            );
            assert.deepEqual(pageErrors, []);
            results.push({
              locale,
              taskId: id,
              status: task.status,
              model: task.lastModelId,
              noAutomaticSubmission: true,
              noInferenceOnSave: true,
              draftRetained: true,
              overflow: false,
              tools: ["calculate", "complete_task"],
              calls: 3,
              simulatedUsage: true,
            });
            console.log(`Offline guided runtime case passed: ${locale}`);
          } finally {
            await context.close();
          }
        }
        assert.deepEqual(unexpected, []);
        const afterSource = await sourceIdentity();
        assert.deepEqual(
          afterSource,
          beforeSource,
          "Source changed during native acceptance",
        );
        await writeFile(
          path.join(directory, "guided-local-runtime-evidence.json"),
          JSON.stringify(
            {
              passed: true,
              verifiedAt: new Date().toISOString(),
              platform: process.platform,
              nodeVersion: process.version,
              ...beforeSource,
              sourceStable: true,
              locales,
              results,
              requests,
              scope:
                "Real installer, owned PostgreSQL, authenticated API, two workers and rendered UI. Only Ollama responses/judge are fixed offline fixtures. No human login, paid call, real model quality, native Codex, physical phone, container, other host OS or 24h acceptance.",
            },
            null,
            2,
          ),
        );
      } finally {
        await browser.close();
      }
    },
  });
  console.log(JSON.stringify({ passed: true, evidenceDirectory }));
} finally {
  peer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    peer.close((error) => (error ? reject(error) : resolve())),
  );
}
