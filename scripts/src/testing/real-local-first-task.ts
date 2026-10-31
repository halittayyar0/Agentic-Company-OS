import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { ProcessSupervisor } from "../endurance/process-supervisor";
import { reserveLoopbackPorts } from "../endurance/native-postgres-harness";
import { sha256ExactFile } from "../endurance/native-runtime-provenance";
import { createOllamaSmokeEnvironment } from "../ollama-local-boundary-smoke";
import { runNativeInstallSmoke } from "../setup/native-install-smoke";
import { waitForNativePageReady } from "./native-page-readiness";
import { captureRealTaskDelivery } from "./real-local-first-task-viewport";
import {
  observeOwnedFirstTask,
  type TaskReadSummary,
} from "./real-local-first-task-observer";
import {
  verifyRealFirstTask,
  type ModelCapture,
} from "./real-local-first-task-proof";

const model = "qwen3.5:2b-q4_K_M";
const source = fileURLToPath(new URL("../../..", import.meta.url));
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: source,
    windowsHide: true,
    encoding: "utf8",
    timeout: 15000,
  }).trim();
type Task = Parameters<typeof verifyRealFirstTask>[0]["task"] & { id: number };
interface Snapshot {
  preparation: {
    state: string;
    resultDigest: string;
    observedCompletedBytes: number | null;
    observedTotalBytes: number | null;
  } | null;
  availability: { available: boolean };
}

// This command never imports a person's database, model store or provider keys.
async function main() {
  assert.equal(
    process.env.ACOS_REAL_LOCAL_FIRST_TASK,
    "1",
    "explicit_real_first_task_opt_in_required",
  );
  assert.equal(process.platform, "win32", "windows_first_task_proof_only");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v24.22.1");
  const options = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index],
      value = process.argv[index + 1];
    assert.ok(
      ["--runtime", "--postgres", "--public"].includes(key!) &&
        value &&
        path.isAbsolute(value) &&
        !options.has(key!),
      "absolute_unique_fixture_arguments_required",
    );
    options.set(key!, value);
  }
  assert.equal(options.size, 3);
  for (const name of Object.keys(process.env))
    if (
      /^(DATABASE_|OPERATOR_AUTH_|RUNTIME_CONTROL_|OPENAI_|OPENROUTER_|AI_INTEGRATIONS_|REPLIT_OPENROUTER_|OLLAMA_|CHATGPT_|ACOS_CODEX_|WORKSPACE_ENV_FILE$)/u.test(
        name,
      ) &&
      process.env[name]
    )
      throw new Error("clean_synthetic_fixture_environment_required");
  const runtime = await realpath(options.get("--runtime")!);
  const postgres = await realpath(options.get("--postgres")!);
  const inputs = path.dirname(runtime);
  await access(path.join(inputs, ".owned-real-first-task-inputs"));
  assert.equal(
    postgres,
    await realpath(path.join(inputs, "postgres/pgsql/bin")),
  );
  assert.equal(
    await sha256ExactFile(
      path.join(inputs, "ollama.zip"),
      "Pinned official Ollama archive",
    ),
    "e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5",
  );
  assert.equal(
    await sha256ExactFile(
      path.join(inputs, "postgres.zip"),
      "Pinned official PostgreSQL archive",
    ),
    "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3",
  );
  process.env.PATH = postgres + path.delimiter + (process.env.PATH ?? "");
  const parent = await realpath(process.env.RUNNER_TEMP || tmpdir());
  const requestedPublicRoot = path.resolve(options.get("--public")!);
  assert.equal(
    await realpath(path.dirname(requestedPublicRoot)),
    parent,
    "public_output_must_be_a_fresh_runner_child",
  );
  const publicRoot = path.join(parent, path.basename(requestedPublicRoot));
  assert.equal(await lstat(publicRoot).catch(() => null), null);
  await mkdir(publicRoot);
  const privateRoot = await mkdtemp(
    path.join(parent, "acos-genuine-first-task-"),
  );
  await writeFile(
    path.join(privateRoot, ".owned-genuine-first-task"),
    "Synthetic private fixture; never upload\n",
    { flag: "wx", mode: 0o600 },
  );
  for (const directory of ["models", "tmp", "config", "local", "cache"])
    await mkdir(path.join(privateRoot, directory));
  assert.deepEqual(await readdir(path.join(privateRoot, "models")), []);
  const sourceCommit = git("rev-parse", "HEAD"),
    sourceTree = git("rev-parse", "HEAD^{tree}");
  assert.match(sourceCommit, /^[a-f0-9]{40}$/u);
  assert.equal(
    git("status", "--porcelain"),
    "",
    "clean_tested_checkout_required",
  );
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm && path.isAbsolute(pnpm), "invoke_through_pnpm_script");
  await access(pnpm);
  const [daemonPort, relayPort] = await reserveLoopbackPorts(2);
  const daemon = "http://127.0.0.1:" + daemonPort;
  const supervisor = new ProcessSupervisor({
    runId: "genuine-first-task",
    gracefulStopMs: 1000,
    logLimitBytes: 65536,
  });
  const fixtureDrive = path.parse(privateRoot).root.slice(0, 1).toUpperCase();
  assert.match(fixtureDrive, /^[A-Z]$/u);
  const capacity = JSON.parse(
    execFileSync(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `@{freeVirtualKiB=[long](Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory;cFreeBytes=[long](Get-Volume -DriveLetter C).SizeRemaining;fixtureFreeBytes=[long](Get-Volume -DriveLetter ${fixtureDrive}).SizeRemaining} | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 65536 },
    ),
  );
  assert.ok(
    capacity.freeVirtualKiB >= 6291456 &&
      capacity.cFreeBytes >= 2147483648 &&
      capacity.fixtureFreeBytes >= 8589934592,
    "original_cold_test_resource_margins_required",
  );
  const calls: {
    requestFile: string;
    responseFile?: string;
    status?: number;
    requestSha256: string;
    responseSha256?: string;
  }[] = [];
  const screenshots: {
    width: number;
    height: number;
    overflow: boolean;
    deliveryVisible: boolean;
    file: string;
    sha256: string;
  }[] = [];
  let stage = "start_runtime",
    accepted = false,
    nativeFinished = false,
    cleanupVerified = false,
    pulls = 0,
    relayFailures = 0;
  let verified: ReturnType<typeof verifyRealFirstTask> | undefined;
  let modelDigest: string | undefined, registryEntries: number | undefined;
  const taskObservation: TaskReadSummary = {
    attempts: 0,
    transientFailures: 0,
    lastFailure: null,
    lastTaskAt: null,
  };
  let failureCode: string | null = null;
  let nativeDirectory: string | undefined;
  let task: Task | undefined;
  const startedAt = new Date().toISOString();
  const relay = createServer(async (request, response) => {
    const controller = new AbortController();
    response.once("close", () => controller.abort());
    try {
      assert.ok(
        [
          "/api/version",
          "/api/tags",
          "/api/show",
          "/api/pull",
          "/v1/chat/completions",
        ].includes(request.url!),
      );
      assert.ok(["GET", "POST"].includes(request.method!));
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 1048576);
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks),
        inference = request.url === "/v1/chat/completions";
      if (request.url === "/api/pull") {
        assert.deepEqual(JSON.parse(body.toString()), {
          model,
          stream: true,
          insecure: false,
        });
        assert.equal(++pulls, 1, "one_model_transfer_required");
      }
      let row: (typeof calls)[number] | undefined;
      if (inference) {
        assert.ok(calls.length < 12, "genuine_call_cap_exceeded");
        assert.equal(JSON.parse(body.toString()).model, model + ":local");
        row = {
          requestFile: path.join(
            privateRoot,
            "request-" + calls.length + ".json",
          ),
          requestSha256: hash(body),
        };
        calls.push(row);
        await writeFile(row.requestFile, body, { flag: "wx", mode: 0o600 });
        console.log(
          JSON.stringify({ phase: "local_inference", call: calls.length }),
        );
      }
      const upstream = await fetch(daemon + request.url, {
        method: request.method,
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(inference ? 240000 : 1200000),
        ]),
        headers: { "Content-Type": "application/json" },
        ...(body.length ? { body } : {}),
      });
      response.statusCode = upstream.status;
      response.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") ?? "application/json",
      );
      if (request.url === "/api/pull") {
        assert.ok(upstream.ok && upstream.body);
        for await (const bytes of upstream.body) {
          if (response.destroyed) break;
          response.write(bytes);
        }
        response.end();
      } else {
        const bytes = Buffer.from(await upstream.arrayBuffer());
        assert.ok(bytes.length < 4194304);
        if (row) {
          row.responseFile = path.join(
            privateRoot,
            "response-" + calls.indexOf(row) + ".json",
          );
          row.responseSha256 = hash(bytes);
          row.status = upstream.status;
          await writeFile(row.responseFile, bytes, { flag: "wx", mode: 0o600 });
          console.log(
            JSON.stringify({
              phase: "local_response",
              call: calls.indexOf(row) + 1,
              status: upstream.status,
            }),
          );
        }
        response.end(bytes);
      }
    } catch {
      if (!controller.signal.aborted) relayFailures++;
      response.destroy();
    }
  });
  try {
    const environment = createOllamaSmokeEnvironment(
      process.env,
      privateRoot,
      "127.0.0.1:" + daemonPort,
      "http://127.0.0.1:1",
    );
    for (const key of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ])
      environment[key] = undefined;
    Object.assign(environment, {
      OLLAMA_NUM_PARALLEL: "1",
      OLLAMA_LLM_LIBRARY: "cpu",
      CUDA_VISIBLE_DEVICES: "-1",
      HIP_VISIBLE_DEVICES: "-1",
    });
    supervisor.start({
      name: "owned-genuine-ollama",
      command: path.join(runtime, "ollama.exe"),
      args: ["serve"],
      cwd: privateRoot,
      env: environment,
    });
    await supervisor.waitUntilReady(
      async () => {
        try {
          return (
            await fetch(daemon + "/api/version", {
              signal: AbortSignal.timeout(500),
            })
          ).ok;
        } catch {
          return false;
        }
      },
      {
        timeoutMs: 20000,
        intervalMs: 100,
        label: "Owned genuine local runtime",
      },
    );
    assert.equal(
      (
        (await (await fetch(daemon + "/api/version")).json()) as {
          version: string;
        }
      ).version,
      "0.40.3",
    );
    assert.deepEqual(
      (
        (await (await fetch(daemon + "/api/tags")).json()) as {
          models: unknown[];
        }
      ).models,
      [],
    );
    await new Promise<void>((resolve) =>
      relay.listen(relayPort, "127.0.0.1", resolve),
    );
    stage = "native_installation";
    nativeDirectory = await runNativeInstallSmoke(postgres, pnpm, {
      kind: "local-model",
      run: async ({ baseUrl, operatorToken, directory }) => {
        nativeDirectory = directory;
        const request = async <T>(route: string): Promise<T> => {
          const result = await fetch(baseUrl + "/api" + route, {
            headers: { authorization: "Bearer " + operatorToken },
            signal: AbortSignal.timeout(15000),
            redirect: "error",
          });
          assert.equal(result.ok, true, "native_api_read_failed");
          return (await result.json()) as T;
        };
        assert.equal((await request<unknown[]>("/tasks")).length, 0);
        const agentsBefore = (await request<unknown[]>("/agents")).length;
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            reducedMotion: "reduce",
            extraHTTPHeaders: { authorization: "Bearer " + operatorToken },
          });
          await context.addInitScript(() =>
            localStorage.setItem("acos.locale.v1", "en"),
          );
          const page = await context.newPage();
          const load = async (file: string) =>
            await import(
              pathToFileURL(
                path.join(source, "artifacts/agentic-company-os/src/lib", file),
              ).href
            );
          const h = await (await load("home-copy.ts")).loadHomeCopy("en");
          const c = await (
            await load("connection-copy.ts")
          ).loadConnectionCopy("en");
          const p = await (
            await load("local-model-preparation-copy.ts")
          ).loadModelPreparationCopy("en");
          const s = await (await load("i18n.ts")).loadShellMessages("en");
          const brief =
            "Use calculate to add exactly 58.5 and 14.5. Report the result 73 and complete this one task with complete_task. Do not delegate, create agents, browse, write files or use other tools. If necessary load only calculate and complete_task.";
          await page.goto(baseUrl);
          const draft = page.getByRole("textbox", {
            name: h.desiredOutcome,
            exact: true,
          });
          await waitForNativePageReady(draft);
          await draft.fill(brief);
          await page
            .getByRole("button", { name: s.providerSetupAction, exact: true })
            .click();
          const dialog = page.getByRole("dialog");
          await dialog
            .getByRole("button", { name: c.local, exact: true })
            .click();
          await dialog
            .getByRole("textbox", { name: c.endpoint, exact: true })
            .fill("http://127.0.0.1:" + relayPort);
          await dialog
            .getByRole("button", { name: c.save, exact: true })
            .click();
          await expect(
            dialog.getByRole("status", { name: c.save, exact: true }),
          ).toContainText(c.saved);
          stage = "cold_model_download";
          await dialog
            .getByRole("button", { name: p.download, exact: true })
            .click();
          const deadline = Date.now() + 20 * 60000;
          let snapshot: Snapshot | undefined,
            nextNotice = 0;
          while (Date.now() < deadline) {
            snapshot = await request<Snapshot>("/settings/ollama/preparations");
            if (snapshot.preparation?.state === "ready") break;
            assert.ok(
              !["failed", "interrupted"].includes(
                snapshot.preparation?.state ?? "",
              ),
              "model_transfer_failed_without_retry",
            );
            if (Date.now() > nextNotice) {
              console.log(
                JSON.stringify({
                  phase: stage,
                  state: snapshot.preparation?.state,
                  bytes: snapshot.preparation?.observedCompletedBytes,
                  total: snapshot.preparation?.observedTotalBytes,
                }),
              );
              nextNotice = Date.now() + 15000;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          assert.equal(snapshot?.preparation?.state, "ready");
          assert.equal(snapshot.availability.available, true);
          assert.equal(pulls, 1);
          assert.equal(calls.length, 0, "preparation_must_not_run_inference");
          assert.equal((await request<unknown[]>("/tasks")).length, 0);
          modelDigest = snapshot.preparation.resultDigest.replace(
            /^sha256:/u,
            "",
          );
          assert.match(modelDigest, /^[a-f0-9]{64}$/u);
          await dialog
            .getByRole("region", { name: p.title, exact: true })
            .getByRole("button", { name: p.returnToJob, exact: true })
            .click();
          await expect(draft).toHaveValue(brief);
          await expect(draft).toBeFocused();
          stage = "genuine_first_task";
          await page
            .getByRole("button", { name: h.startProject, exact: true })
            .click();
          await expect(page).toHaveURL(/\/projects\/\d+$/u, { timeout: 15000 });
          const id = Number(new URL(page.url()).pathname.split("/").at(-1));
          const taskDeadline = Date.now() + 15 * 60000;
          task = await observeOwnedFirstTask<Task>({
            baseUrl,
            operatorToken,
            taskId: id,
            deadline: taskDeadline,
            summary: taskObservation,
            onTask: (value) => {
              task = value;
            },
          });
          assert.equal(
            task.status,
            "completed",
            "first_task_stopped_without_retry",
          );
          const captures: ModelCapture[] = [];
          for (const call of calls) {
            assert.ok(
              call.responseFile &&
                call.responseSha256 &&
                call.status !== undefined,
            );
            const requestBytes = await readFile(call.requestFile),
              responseBytes = await readFile(call.responseFile);
            assert.equal(hash(requestBytes), call.requestSha256);
            assert.equal(hash(responseBytes), call.responseSha256);
            captures.push({
              status: call.status,
              request: JSON.parse(requestBytes.toString()),
              response: JSON.parse(responseBytes.toString()),
            });
          }
          verified = verifyRealFirstTask({
            model,
            captures,
            task,
            tasksAfter: (await request<unknown[]>("/tasks")).length,
            agentsBefore,
            agentsAfter: (await request<unknown[]>("/agents")).length,
            sourceUnchanged:
              git("rev-parse", "HEAD^{tree}") === sourceTree &&
              git("status", "--porcelain") === "",
          });
          stage = "completed_task_viewports";
          await page.reload();
          for (const width of [320, 1024]) {
            const { image, overflow, deliveryVisible } =
              await captureRealTaskDelivery(page, width);
            const name = "completed-task-" + width + ".png";
            await writeFile(path.join(publicRoot, name), image, { flag: "wx" });
            screenshots.push({
              width,
              height: 844,
              overflow,
              deliveryVisible,
              file: name,
              sha256: hash(image),
            });
          }
          await writeFile(
            path.join(privateRoot, "native-directory.txt"),
            directory,
            { flag: "wx", mode: 0o600 },
          );
        } finally {
          await browser.close();
        }
      },
    });
    nativeFinished = true;
    assert.equal(relayFailures, 0);
    stage = "registry_blob_identity";
    const publicManifestResponse = await fetch(
      "https://registry.ollama.ai/v2/library/qwen3.5/manifests/2b-q4_K_M",
      { redirect: "error", signal: AbortSignal.timeout(30000) },
    );
    assert.equal(publicManifestResponse.status, 200);
    const manifestBytes = Buffer.from(
      await publicManifestResponse.arrayBuffer(),
    );
    assert.ok(manifestBytes.length > 0 && manifestBytes.length < 65536);
    assert.equal(hash(manifestBytes), modelDigest);
    const manifest = JSON.parse(manifestBytes.toString());
    const stored = JSON.parse(
      await readFile(
        path.join(
          privateRoot,
          "models/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(stored.config, manifest.config);
    assert.deepEqual(stored.layers.slice(0, -1), manifest.layers);
    assert.equal(stored.layers.length, manifest.layers.length + 1);
    const anchor = stored.layers.at(-1);
    assert.deepEqual(anchor, {
      mediaType: manifest.mediaType,
      digest: "sha256:" + modelDigest,
      size: manifestBytes.length,
    });
    assert.deepEqual(
      await readFile(
        path.join(privateRoot, "models/blobs/sha256-" + modelDigest),
      ),
      manifestBytes,
    );
    registryEntries = 0;
    for (const entry of [manifest.config, ...manifest.layers]) {
      assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/u);
      assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0);
      const file = path.join(
        privateRoot,
        "models/blobs",
        entry.digest.replace(":", "-"),
      );
      assert.equal((await lstat(file)).size, entry.size);
      assert.equal(
        "sha256:" + (await sha256ExactFile(file, "New genuine model blob")),
        entry.digest,
      );
      registryEntries++;
    }
    assert.equal(git("rev-parse", "HEAD"), sourceCommit);
    assert.equal(git("status", "--porcelain"), "");
    accepted = true;
    stage = "complete";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    failureCode =
      /^(?:task_observation_(?:deadline|transient_limit)|terminal_task_observation_http_\d{3}|invalid_task_observation_(?:json|state)|unexpected_task_observation_error)$/u.test(
        message,
      )
        ? message
        : "proof_step_failed";
    process.exitCode = 1;
    console.error("Genuine first-task proof failed at fixed stage: " + stage);
  } finally {
    try {
      await supervisor.stopAll();
      relay.closeAllConnections();
      if (relay.listening)
        await new Promise<void>((resolve, reject) =>
          relay.close((error) => (error ? reject(error) : resolve())),
        );
      cleanupVerified =
        nativeFinished &&
        supervisor.snapshots().every((process) => !process.running);
    } catch {
      cleanupVerified = false;
    }
    accepted &&= cleanupVerified;
    if (!accepted) process.exitCode = 1;
    // Raw requests, database credentials and runtime logs remain private. This
    // literal projection is the only machine-readable artifact uploaded by CI.
    const receipt = {
      schema: "agentic-company-os/genuine-first-task@3",
      sourceCommit,
      sourceTree,
      platform: process.platform,
      architecture: process.arch,
      startedAt,
      completedAt: new Date().toISOString(),
      accepted,
      cleanupVerified,
      failureStage: accepted ? null : stage,
      failureCode: accepted ? null : failureCode,
      taskObservation,
      runtimeVersion: "0.40.3",
      postgresVersion: "17.11",
      model,
      modelDigest,
      emptyStoreBefore: true,
      hostAdmission: capacity,
      preseededWeights: false,
      pullRequests: pulls,
      paidProvider: false,
      cloudFallbacks: 0,
      relayFailures,
      verified,
      rawCaptureHashes: calls.map((call) => ({
        requestSha256: call.requestSha256,
        responseSha256: call.responseSha256,
        status: call.status,
      })),
      firstTask: task
        ? {
            id: task.id,
            status: task.status,
            completionAuthority: task.completionAuthority,
            tokensUsed: task.tokensUsed,
            modelFallbackCount: task.modelFallbackCount,
          }
        : null,
      registryEntries,
      screenshots,
      nativeInstallationBackupAndRestartPassed: nativeFinished,
      limits: [
        "Finite synthetic Windows CPU case; no general model-quality guarantee.",
        "Viewport evidence is not a physical-phone or Safari test.",
        "No real 24-hour endurance proof; verified24h is false.",
        "Raw host fixtures and model captures are deliberately not uploaded.",
      ],
      verified24h: false,
    };
    const output = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
    const forbidden: Buffer[] = [];
    // Include every generated installation secret in a last literal exclusion
    // check. A public receipt is withheld entirely on any detected match.
    if (nativeDirectory) {
      for (const name of await readdir(nativeDirectory)) {
        if (!/^instance-[a-f0-9-]{36}$/u.test(name)) continue;
        const secrets = path.join(nativeDirectory, name, "secrets");
        for (const file of await readdir(secrets))
          forbidden.push(
            Buffer.from(
              (await readFile(path.join(secrets, file), "utf8")).trim(),
            ),
          );
      }
      forbidden.push(
        Buffer.from(
          (
            await readFile(path.join(nativeDirectory, "password"), "utf8")
          ).trim(),
        ),
      );
    }
    assert.ok(
      !forbidden.some((secret) => secret.length > 8 && output.includes(secret)),
      "private_fixture_value_in_public_projection",
    );
    await writeFile(path.join(publicRoot, "receipt.json"), output, {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        accepted,
        cleanupVerified,
        calls: calls.length,
        tokens: verified?.tokens ?? null,
        arithmeticResult: verified?.arithmeticResult ?? null,
      }),
    );
  }
}

await main().catch(() => {
  console.error(
    "Genuine first-task preflight or evidence write failed; no private diagnostic text is published.",
  );
  process.exitCode = 1;
});
