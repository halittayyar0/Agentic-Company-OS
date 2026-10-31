import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  realpath,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProcessSupervisor } from "../../scripts/src/endurance/process-supervisor";
import { reserveLoopbackPorts } from "../../scripts/src/endurance/native-postgres-harness";
import { sha256ExactFile } from "../../scripts/src/endurance/native-runtime-provenance";
import { createOllamaSmokeEnvironment } from "../../scripts/src/ollama-local-boundary-smoke";
import { createPrivateModelRelay } from "./model-relay.mjs";

const execute = promisify(execFile);
export const releaseModel = "qwen3.5:2b-q4_K_M";
const expectedModelDigest =
  "1e2d21a4f03ab9e4a9c1976a4b7e88f21de61d65f2c5485d8fde8942be73f1e7";
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");

export interface ModelPreparationTrace {
  phase: string;
  lastHttpStatus: number | null;
  daemonCreated: boolean;
  daemonReady: boolean;
  daemonExitCode: number | null;
  pullRequests: number;
  pullCompleted: boolean;
  modelCleanupVerified: boolean | null;
  registryEntriesVerified: number;
  hostAdmission: {
    freeVirtualKiB: number | null;
    cFreeBytes: number | null;
    fixtureFreeBytes: number | null;
  } | null;
}
export function newModelPreparationTrace(): ModelPreparationTrace {
  return {
    phase: "not_started",
    lastHttpStatus: null,
    daemonCreated: false,
    daemonReady: false,
    daemonExitCode: null,
    pullRequests: 0,
    pullCompleted: false,
    registryEntriesVerified: 0,
    hostAdmission: null,
    modelCleanupVerified: null,
  };
}
export function recordHostAdmission(
  trace: ModelPreparationTrace,
  value: Record<string, unknown>,
) {
  const field = (name: string) =>
    Number.isSafeInteger(value[name]) && Number(value[name]) >= 0
      ? Number(value[name])
      : null;
  trace.hostAdmission = {
    freeVirtualKiB: field("freeVirtualKiB"),
    cFreeBytes: field("cFreeBytes"),
    fixtureFreeBytes: field("fixtureFreeBytes"),
  };
}

export async function requireReleaseHostMargins(
  fixtureRoot: string,
  trace?: ModelPreparationTrace,
) {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  const drive = path.parse(fixtureRoot).root.slice(0, 1).toUpperCase();
  assert.match(drive, /^[A-Z]$/u);
  const powershell = path.join(
    process.env.SystemRoot!,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const command =
    "@{freeVirtualKiB=[long](Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory;cFreeBytes=[long](Get-Volume -DriveLetter C).SizeRemaining;fixtureFreeBytes=[long](Get-Volume -DriveLetter " +
    drive +
    ").SizeRemaining}|ConvertTo-Json -Compress";
  const value = JSON.parse(
    (
      await execute(
        powershell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        {
          windowsHide: true,
          encoding: "utf8",
          timeout: 15000,
          maxBuffer: 65536,
        },
      )
    ).stdout,
  );
  if (trace) recordHostAdmission(trace, value);
  for (const field of ["freeVirtualKiB", "cFreeBytes", "fixtureFreeBytes"])
    assert.ok(Number.isSafeInteger(value[field]) && value[field] > 0);
  assert.ok(
    value.freeVirtualKiB >= 6291456 &&
      value.cFreeBytes >= 2147483648 &&
      value.fixtureFreeBytes >= 8589934592,
    "original_test_host_resource_margins_required",
  );
  return value;
}

/** Executed only inside the verified ordinary disposable CI-user fixture. */
export async function startOwnedReleaseModel(
  inputsRoot: string,
  executionRoot: string,
  trace: ModelPreparationTrace = newModelPreparationTrace(),
) {
  trace.phase = "ordinary_context";
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v24.22.1");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, "1");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(
    process.env.GH_TOKEN,
    undefined,
    "workflow_token_must_not_enter_model_execution",
  );
  assert.equal(
    process.env.GITHUB_TOKEN,
    undefined,
    "workflow_token_must_not_enter_model_execution",
  );
  const parent = await realpath(process.env.RUNNER_TEMP!);
  const privateRoot = await realpath(executionRoot),
    input = await realpath(inputsRoot);
  assert.equal(
    privateRoot,
    await realpath(process.env.ACOS_PRIVATE_EXECUTION_ROOT!),
  );
  assert.equal(path.dirname(privateRoot), parent);
  assert.ok(path.basename(privateRoot).startsWith("acos-native-user-"));
  assert.equal(path.dirname(input), parent);
  assert.ok(path.basename(input).startsWith("acos-native-release-host-"));
  assert.notEqual(input, privateRoot);
  const ordinary = JSON.parse(
    await readFile(process.env.ACOS_EXECUTION_CONTEXT_PATH!, "utf8"),
  );
  assert.deepEqual(
    ordinary,
    {
      administratorToken: false,
      identityVerified: true,
      readonlyControlsVerified: true,
    },
    "actual_ordinary_execution_context_required",
  );
  trace.phase = "host_resources";
  const admission = await requireReleaseHostMargins(privateRoot, trace);
  trace.phase = "pinned_runtime_bytes";
  const runtime = JSON.parse(
    await readFile(path.join(input, "ollama-input.json"), "utf8"),
  );
  assert.equal(runtime.accepted, true);
  assert.equal(runtime.runtimeVersion, "0.40.3");
  assert.equal(runtime.executedCode, false);
  assert.equal(
    runtime.archiveSha256,
    "e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5",
  );
  assert.equal(
    await sha256ExactFile(runtime.archive, "Pinned complete model runtime"),
    runtime.archiveSha256,
  );
  const runtimeRoot = await realpath(runtime.runtimeRoot);
  assert.equal(runtimeRoot, path.join(input, "ollama-runtime"));
  assert.equal(runtime.files.length, 44);
  for (const file of runtime.files) {
    assert.ok(
      file.path === "ollama.exe" ||
        /^lib\/ollama\/[A-Za-z0-9+_.-]+$/u.test(file.path),
    );
    assert.ok(
      file.path
        .split("/")
        .every((part: string) => part !== "." && part !== ".."),
    );
    const candidate = path.join(runtimeRoot, file.path),
      actual = await realpath(candidate);
    assert.ok(actual.startsWith(runtimeRoot + path.sep));
    assert.equal((await lstat(candidate)).isSymbolicLink(), false);
    assert.equal((await lstat(candidate)).size, file.bytes);
    assert.equal(
      await sha256ExactFile(candidate, "Pinned model runtime file"),
      file.sha256,
    );
  }
  trace.phase = "empty_private_model_home";
  const modelHome = path.join(privateRoot, "model-home");
  await mkdir(modelHome);
  for (const name of ["models", "tmp", "config", "local", "cache"])
    await mkdir(path.join(modelHome, name));
  assert.deepEqual(await readdir(path.join(modelHome, "models")), []);
  await writeFile(
    path.join(modelHome, ".owned-model-home"),
    "Private synthetic model fixture\n",
    { flag: "wx", mode: 0o600 },
  );
  const [daemonPort] = await reserveLoopbackPorts(1),
    daemon = "http://127.0.0.1:" + daemonPort;
  const supervisor = new ProcessSupervisor({
    runId: "genuine-native-release-model",
    gracefulStopMs: 1000,
    logLimitBytes: 65536,
  });
  let relay: Awaited<ReturnType<typeof createPrivateModelRelay>> | undefined;
  try {
    const environment = createOllamaSmokeEnvironment(
      process.env,
      modelHome,
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
    trace.phase = "daemon_start";
    const daemonProcess = supervisor.start({
      name: "owned-native-release-ollama",
      command: path.join(runtimeRoot, "ollama.exe"),
      args: ["serve"],
      cwd: modelHome,
      env: environment,
    });
    trace.daemonCreated =
      Number.isSafeInteger(daemonProcess.pid) && Number(daemonProcess.pid) > 0;
    trace.phase = "daemon_readiness";
    await supervisor.waitUntilReady(
      async () => {
        assert.equal(
          supervisor.snapshot("owned-native-release-ollama")?.running,
          true,
        );
        try {
          return (
            await fetch(daemon + "/api/version", {
              redirect: "error",
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
        label: "Owned native release model",
      },
    );
    trace.daemonReady = true;
    trace.phase = "daemon_version";
    const version = (await (
      await fetch(daemon + "/api/version", {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      })
    ).json()) as any;
    assert.equal(version.version, "0.40.3");
    trace.phase = "empty_model_catalog";
    const before = (await (
      await fetch(daemon + "/api/tags", {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      })
    ).json()) as any;
    assert.deepEqual(before.models, [], "owned_empty_model_store_required");
    console.log(
      JSON.stringify({
        phase: "owned_model_download",
        emptyStoreBefore: true,
        pullRequests: 1,
      }),
    );
    // One direct public-model transfer; this does not claim a second app-UI download.
    trace.phase = "single_model_transfer";
    trace.pullRequests = 1;
    const response = await fetch(daemon + "/api/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: releaseModel,
        stream: true,
        insecure: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20 * 60000),
    });
    trace.lastHttpStatus = response.status;
    assert.equal(response.status, 200);
    assert.ok(response.body);
    let pending = "",
      success = false;
    const decoder = new TextDecoder();
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });
      assert.ok(pending.length <= 262144, "bounded_model_progress_required");
      let index;
      while ((index = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (!line.trim()) continue;
        const progress = JSON.parse(line);
        assert.equal(
          progress.error,
          undefined,
          "model_transfer_failed_without_retry",
        );
        if (progress.status === "success") success = true;
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      const progress = JSON.parse(pending);
      assert.equal(
        progress.error,
        undefined,
        "model_transfer_failed_without_retry",
      );
      if (progress.status === "success") success = true;
    }
    assert.equal(success, true, "model_transfer_must_complete");
    trace.pullCompleted = true;
    trace.phase = "downloaded_model_catalog";
    const tags = (await (
      await fetch(daemon + "/api/tags", {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      })
    ).json()) as any;
    assert.equal(tags.models.length, 1);
    assert.equal(tags.models[0].name, releaseModel);
    assert.equal(
      String(tags.models[0].digest).replace(/^sha256:/u, ""),
      expectedModelDigest,
    );
    trace.phase = "anonymous_registry_manifest";
    const publicManifestResponse = await fetch(
      "https://registry.ollama.ai/v2/library/qwen3.5/manifests/2b-q4_K_M",
      { redirect: "error", signal: AbortSignal.timeout(30000) },
    );
    trace.lastHttpStatus = publicManifestResponse.status;
    assert.equal(publicManifestResponse.status, 200);
    const manifestBytes = Buffer.from(
      await publicManifestResponse.arrayBuffer(),
    );
    assert.ok(manifestBytes.length > 0 && manifestBytes.length < 65536);
    assert.equal(hash(manifestBytes), expectedModelDigest);
    const manifest = JSON.parse(manifestBytes.toString());
    trace.phase = "stored_manifest_anchor";
    const stored = JSON.parse(
      await readFile(
        path.join(
          modelHome,
          "models/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(stored.config, manifest.config);
    assert.deepEqual(stored.layers.slice(0, -1), manifest.layers);
    assert.equal(stored.layers.length, manifest.layers.length + 1);
    assert.deepEqual(stored.layers.at(-1), {
      mediaType: manifest.mediaType,
      digest: "sha256:" + expectedModelDigest,
      size: manifestBytes.length,
    });
    assert.deepEqual(
      await readFile(
        path.join(modelHome, "models/blobs/sha256-" + expectedModelDigest),
      ),
      manifestBytes,
    );
    trace.phase = "downloaded_blob_bytes";
    let entries = 0;
    for (const entry of [manifest.config, ...manifest.layers]) {
      assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/u);
      assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0);
      const file = path.join(
        modelHome,
        "models/blobs",
        entry.digest.replace(":", "-"),
      );
      assert.equal((await lstat(file)).isSymbolicLink(), false);
      assert.equal((await lstat(file)).size, entry.size);
      assert.equal(
        "sha256:" + (await sha256ExactFile(file, "New owned model blob")),
        entry.digest,
      );
      entries++;
      trace.registryEntriesVerified = entries;
    }
    assert.equal(entries, 6);
    const rawRoot = path.join(privateRoot, "private-model-captures");
    await mkdir(rawRoot);
    trace.phase = "private_capture_relay";
    relay = await createPrivateModelRelay({
      upstream: daemon,
      root: rawRoot,
      maxCalls: 12,
    });
    console.log(
      JSON.stringify({
        phase: "owned_model_ready",
        registryEntries: entries,
        emptyStoreBefore: true,
        pullRequests: 1,
      }),
    );
    const close = async () => {
      trace.modelCleanupVerified = false;
      let relayStopped = false;
      try {
        await relay!.close();
        relayStopped = true;
      } finally {
        await supervisor.stopAll();
      }
      assert.ok(
        relayStopped && supervisor.snapshots().every((item) => !item.running),
        "owned_model_cleanup_required",
      );
      trace.modelCleanupVerified = true;
      return { cleanupVerified: true };
    };
    trace.phase = "ready";
    return {
      relay,
      admission,
      modelHome,
      modelDigest: expectedModelDigest,
      runtimeVersion: "0.40.3",
      registryEntries: entries,
      pullRequests: 1,
      emptyStoreBefore: true,
      close,
    };
  } catch {
    trace.daemonExitCode =
      supervisor.snapshot("owned-native-release-ollama")?.exitCode ?? null;
    trace.modelCleanupVerified = false;
    try {
      await relay?.close();
    } finally {
      await supervisor.stopAll();
    }
    trace.modelCleanupVerified = supervisor
      .snapshots()
      .every((item) => !item.running);
    assert.equal(
      trace.modelCleanupVerified,
      true,
      "owned_model_cleanup_required",
    );
    throw new Error("owned_model_start_or_download_failed");
  }
}
