import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { runNativeInstallSmoke } from "../setup/native-install-smoke";
import { createControlledArithmeticPeer } from "./controlled-arithmetic-peer";

// Real owned installation; the only simulated component is the model HTTP peer.
if (process.env.ACOS_REUSABLE_GUIDES_SMOKE !== "1")
  throw new Error("explicit_reusable_guides_smoke_required");
const [postgresBin, explicitPnpmPath] = process.argv.slice(2);
const pnpmPath = explicitPnpmPath ?? process.env.npm_execpath;
assert.ok(postgresBin && path.isAbsolute(postgresBin));
assert.ok(pnpmPath && path.isAbsolute(pnpmPath));
for (const name of Object.keys(process.env))
  if (
    /^(DATABASE_|OPERATOR_AUTH_|RUNTIME_CONTROL_|OPENAI_|OPENROUTER_|AI_INTEGRATIONS_|REPLIT_OPENROUTER_|OLLAMA_|CHATGPT_|ACOS_CODEX_|AGENT_SANDBOX_|ALLOW_AGENT_CODEX_TASKS$|WORKSPACE_ENV_FILE$|SYNTHETIC_|ENDURANCE_)/u.test(
      name,
    ) &&
    process.env[name] &&
    name !== "ENDURANCE_POSTGRES_ROOT"
  )
    throw new Error("offline_fixture_requires_clean_environment");
const source = fileURLToPath(new URL("../../..", import.meta.url));
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
const peer = await createControlledArithmeticPeer({ maxRequests: 256 });
const locales = ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"] as const;
const results: unknown[] = [];
let ownedBaseUrl: string | undefined;
let evidenceDirectory: string | undefined;
try {
  evidenceDirectory = await runNativeInstallSmoke(postgresBin, pnpmPath, {
    kind: "offline-guided",
    run: async ({ baseUrl, operatorToken, directory }) => {
      ownedBaseUrl = baseUrl;
      console.log("Owned reusable-guide evidence directory: " + directory);
      let rateRemaining = 0;
      let rateResetSeconds = 0;
      const request = async <T = Record<string, unknown>>(
        route: string,
        method = "GET",
        body?: unknown,
      ): Promise<T> => {
        const response = await fetch(baseUrl + "/api" + route, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            authorization: `Bearer ${operatorToken}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.equal(
          response.ok,
          true,
          `${method} ${route}: ${response.status}`,
        );
        rateRemaining = Number(response.headers.get("RateLimit-Remaining"));
        rateResetSeconds = Number(response.headers.get("RateLimit-Reset"));
        assert.ok(Number.isInteger(rateRemaining) && rateRemaining >= 0);
        assert.ok(
          Number.isInteger(rateResetSeconds) &&
            rateResetSeconds > 0 &&
            rateResetSeconds <= 60,
        );
        return (await response.json()) as T;
      };
      assert.equal((await fetch(baseUrl + "/api/tasks")).status, 401);
      const initialAgents = await request<unknown[]>("/agents");
      assert.equal((await request<unknown[]>("/tasks")).length, 0);
      const settings = await request("/settings/llm");
      await request("/settings/llm", "PUT", {
        expectedRevision: settings.revision,
        ollamaBaseUrl: peer.endpoint,
      });
      const browser = await chromium.launch({ headless: true });
      const copyRoot = path.join(
        source,
        "artifacts/agentic-company-os/src/lib",
      );
      const freshModule = await import(
        pathToFileURL(path.join(copyRoot, "new-project-copy.ts")).href
      );
      const reuseModule = await import(
        pathToFileURL(path.join(copyRoot, "reusable-work-copy.ts")).href
      );
      const editorModule = await import(
        pathToFileURL(path.join(copyRoot, "extension-editor-copy.ts")).href
      );
      try {
        for (const locale of locales) {
          // Each rendered journey makes UI reads as well as proof reads. Reserve
          // a complete production window before the next case; never retry a
          // mutation or enlarge the application's limiter for this acceptance.
          await request("/agents");
          if (rateRemaining < 250) {
            console.log(
              "Awaiting production read window before locale: " + locale,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, (rateResetSeconds + 1) * 1000),
            );
          }
          const fresh = await freshModule.loadNewProjectCopy(locale);
          const reuse = await reuseModule.loadReusableWorkCopy(locale);
          const editor = await editorModule.loadExtensionEditorCopy(locale);
          const customization = (
            await import(
              pathToFileURL(
                path.join(
                  copyRoot,
                  `customization-copy/customization-${locale}.ts`,
                ),
              ).href
            )
          ).default;
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
          const taskWrites: Record<string, unknown>[] = [];
          const guideWrites: Record<string, unknown>[] = [];
          const pageErrors: string[] = [];
          page.on("pageerror", () => pageErrors.push("pageerror"));
          page.on("request", (sent) => {
            const route = new URL(sent.url()).pathname;
            if (route === "/api/tasks" && sent.method() === "POST")
              taskWrites.push(sent.postDataJSON());
            if (route === "/api/skills/extensions" && sent.method() === "PUT")
              guideWrites.push(sent.postDataJSON());
          });
          await page.route("**/*", (route) =>
            new URL(route.request().url()).origin === new URL(baseUrl).origin
              ? route.continue()
              : route.abort(),
          );
          const calls = () => peer.requests.filter((entry) => entry.kind);
          const title = `Reusable arithmetic ${locale} — 分析`;
          const brief =
            "Use calculate for 17 × 23, report 391, then complete this one task.\nDo not delegate, create agents, browse or write files.";
          const beforeTasks = (await request<unknown[]>("/tasks")).length;
          const beforeCalls = calls().length;
          async function startAndComplete() {
            const beforeWrites = taskWrites.length;
            const callIndex = calls().length;
            await page
              .getByRole("button", { name: fresh.start, exact: true })
              .click();
            await expect(page).toHaveURL(/\/projects\/\d+$/u, {
              timeout: 15_000,
            });
            assert.equal(taskWrites.length, beforeWrites + 1);
            const submitted = taskWrites.at(-1)!;
            assert.deepEqual(Object.keys(submitted).sort(), [
              "autonomyMode",
              "brief",
              "priority",
              "requestId",
              "title",
            ]);
            assert.equal(submitted.title, title);
            assert.equal(submitted.brief, brief);
            assert.equal(submitted.autonomyMode, "finite");
            assert.equal(submitted.priority, "normal");
            const id = Number(new URL(page.url()).pathname.split("/").at(-1));
            const receipt = await request(
              `/task-creation-requests/${submitted.requestId}`,
            );
            assert.equal(receipt.state, "created");
            assert.equal(receipt.taskId, id);
            assert.equal(receipt.requestId, submitted.requestId);
            let task: Record<string, unknown> = {};
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
              task = await request(`/tasks/${id}`);
              if (task.status === "completed") break;
              assert.ok(
                !["failed", "blocked", "cancelled"].includes(
                  String(task.status),
                ),
                `task_${task.status}`,
              );
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            assert.equal(task.status, "completed");
            assert.match(String(task.resultSummary), /391/u);
            assert.equal(task.lastModelId, "ollama:" + peer.model);
            assert.equal(task.modelFallbackCount, 0);
            assert.equal(task.parentTaskId, null);
            assert.equal(task.autonomyMode, "finite");
            assert.deepEqual(await request(`/tasks/${id}/subtasks`), []);
            assert.deepEqual(
              calls()
                .slice(callIndex)
                .map((entry) => entry.kind),
              ["calculate", "complete_task", "judge"],
            );
            assert.equal(
              (await request<unknown[]>("/agents")).length,
              initialAgents.length,
            );
            return { id, requestId: submitted.requestId, task };
          }
          try {
            await page.goto(baseUrl + "/projects/new");
            await page
              .getByRole("textbox", { name: fresh.projectName, exact: true })
              .fill(title);
            await page
              .getByRole("textbox", { name: fresh.brief, exact: true })
              .fill(brief);
            assert.equal(taskWrites.length, 0);
            assert.equal(calls().length, beforeCalls);
            const original = await startAndComplete();
            await page.reload();
            await page
              .getByRole("button", { name: reuse.prepareGuide, exact: true })
              .click();
            await expect(page).toHaveURL(/\/skills$/u);
            const panel = page.getByRole("region", {
              name: customization.extensions[0],
            });
            await expect(
              panel.getByLabel(customization.extensions[3], { exact: true }),
            ).toHaveValue(title);
            await expect(
              panel.getByLabel(customization.extensions[8], { exact: true }),
            ).toHaveValue(brief);
            await expect(
              panel.getByRole("checkbox", {
                name: editor.availability,
                exact: true,
              }),
            ).not.toBeChecked();
            const draft = await page.evaluate(() =>
              JSON.parse(sessionStorage.getItem("acos.extension-editor.v1")!),
            );
            assert.match(draft.manifest.id, /^user-[a-f0-9-]+$/u);
            assert.equal(guideWrites.length, 0);
            assert.equal(taskWrites.length, 1);
            assert.equal(calls().length, beforeCalls + 3);
            await panel
              .getByRole("button", {
                name: customization.extensions[11],
                exact: true,
              })
              .click();
            await expect
              .poll(async () => {
                const rows =
                  await request<Record<string, unknown>[]>(
                    "/skills/extensions",
                  );
                return rows.some((row) => row.id === draft.manifest.id);
              })
              .toBe(true);
            const rows = await request<
              {
                id: string;
                revision: number;
                enabled: boolean;
                manifest: { title: string; instructions: string };
              }[]
            >("/skills/extensions");
            const saved = rows.find((row) => row.id === draft.manifest.id)!;
            assert.equal(saved.revision, 1);
            assert.equal(saved.enabled, false);
            assert.equal(saved.manifest.title, title);
            assert.equal(saved.manifest.instructions, brief);
            assert.equal(guideWrites.length, 1);
            assert.deepEqual(Object.keys(guideWrites[0]).sort(), [
              "enabled",
              "expectedRevision",
              "manifest",
            ]);
            assert.equal(taskWrites.length, 1);
            assert.equal(calls().length, beforeCalls + 3);
            // Other language cases' guides stay disabled; select this exact row.
            const prepare = panel
              .getByRole("listitem")
              .filter({ hasText: title })
              .getByRole("button", { name: reuse.prepareProject, exact: true });
            await prepare.click();
            await expect(page).toHaveURL(/\/projects\/new$/u);
            await expect(
              page.getByRole("textbox", {
                name: fresh.projectName,
                exact: true,
              }),
            ).toHaveValue(title);
            await expect(
              page.getByRole("textbox", { name: fresh.brief, exact: true }),
            ).toHaveValue(brief);
            await expect(
              page.getByText(reuse.runtimeHelp, { exact: true }),
            ).toBeVisible();
            assert.equal(taskWrites.length, 1);
            assert.equal(calls().length, beforeCalls + 3);
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
              path: path.join(directory, `reusable-${locale}.png`),
              fullPage: true,
            });
            const reused = await startAndComplete();
            assert.notEqual(reused.id, original.id);
            assert.notEqual(reused.requestId, original.requestId);
            assert.equal(
              (await request<unknown[]>("/tasks")).length,
              beforeTasks + 2,
            );
            assert.equal(
              (
                await request<{ id: string; enabled: boolean }[]>(
                  "/skills/extensions",
                )
              ).find((row) => row.id === saved.id)!.enabled,
              false,
            );
            assert.deepEqual(pageErrors, []);
            results.push({
              locale,
              sourceTaskId: original.id,
              freshTaskId: reused.id,
              guideId: saved.id,
              guideRevision: saved.revision,
              guideEnabled: false,
              freshRequestId: reused.requestId,
              taskCreations: 2,
              controlledCalls: 6,
              preparationCalls: 0,
              preparationStarts: 0,
              guideWrites: 1,
              noDelegation: true,
              exactText: true,
            });
            console.log("Owned reusable-guide runtime case passed: " + locale);
          } finally {
            await context.close();
          }
        }
        assert.deepEqual(peer.unexpected, []);
        assert.deepEqual(
          await sourceIdentity(),
          beforeSource,
          "Source changed during native acceptance",
        );
        await writeFile(
          path.join(directory, "reusable-project-guides-evidence.json"),
          JSON.stringify(
            {
              passed: true,
              verifiedAt: new Date().toISOString(),
              platform: process.platform,
              nodeVersion: process.version,
              ...beforeSource,
              sourceStable: true,
              results,
              requests: peer.requests,
              scope:
                "Real owned native PostgreSQL installation, authenticated API, two workers and rendered phone-width UI. Controlled model responses/judge and simulated token usage. No paid/live model quality, physical phone, container, other host OS or 24h acceptance.",
            },
            null,
            2,
          ),
          { flag: "wx" },
        );
      } finally {
        await browser.close();
      }
    },
  });
} finally {
  await peer.close();
}
assert.ok(evidenceDirectory && ownedBaseUrl);
await assert.rejects(
  fetch(ownedBaseUrl + "/api/readyz", { signal: AbortSignal.timeout(2_000) }),
);
await assert.rejects(
  fetch(peer.endpoint + "/api/tags", { signal: AbortSignal.timeout(2_000) }),
);
await assert.rejects(
  stat(path.join(evidenceDirectory, "postgres-data/postmaster.pid")),
  { code: "ENOENT" },
);
assert.deepEqual(await sourceIdentity(), beforeSource);
await writeFile(
  path.join(evidenceDirectory, "reusable-project-guides-cleanup.json"),
  JSON.stringify(
    {
      passed: true,
      ownedApiStopped: true,
      ownedPostgresStopped: true,
      controlledPeerStopped: true,
      sourceStable: true,
      ...beforeSource,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({ passed: true, evidenceDirectory, cleanupProved: true }),
);
