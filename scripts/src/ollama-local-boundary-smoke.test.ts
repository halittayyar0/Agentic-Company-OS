import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import * as smoke from "./ollama-local-boundary-smoke";
import { ProcessSupervisor } from "./endurance/process-supervisor";
import {
  createOllamaSmokeEnvironment,
  probeReleasedOllamaBoundary,
  requireLocalAliasRejection,
  requireCloudDisabledRejection,
  cleanupOwnedOllama,
  runOllamaLocalBoundarySmoke,
  stopOwnedOllamaProcesses,
  runOwnedOllamaExtraction,
} from "./ollama-local-boundary-smoke";

function receiptWriter() {
  const writer = Reflect.get(smoke, "writeNewOllamaBoundaryReceipt") as
    ((output: string, contents: string) => Promise<void>) | undefined;
  assert.equal(
    typeof writer,
    "function",
    "descriptor receipt writer is missing",
  );
  return writer!;
}

test("new boundary receipts write the complete document through an owned descriptor", async () => {
  const writer = receiptWriter();
  const root = await mkdtemp(path.join(os.tmpdir(), "acos-receipt-write-"));
  try {
    const output = path.join(root, "receipt.json");
    const contents =
      JSON.stringify({ passed: false, observations: ["owned"] }) + "\n";
    await writer(output, contents);
    assert.equal(await readFile(output, "utf8"), contents);
    await assert.rejects(writer(output, "replacement"), { code: "EEXIST" });
    assert.equal(await readFile(output, "utf8"), contents);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("competing boundary receipt writes admit exactly one complete document", async () => {
  const writer = receiptWriter();
  const root = await mkdtemp(path.join(os.tmpdir(), "acos-receipt-race-"));
  try {
    const output = path.join(root, "receipt.json");
    const documents = ["first-owned-document\n", "second-owned-document\n"];
    const results = await Promise.allSettled(
      documents.map((contents) => writer(output, contents)),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(rejected.reason.code, "EEXIST");
    const winner = results.findIndex((result) => result.status === "fulfilled");
    assert.equal(await readFile(output, "utf8"), documents[winner]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("boundary receipt writing rejects an existing directory without changing its contents", async () => {
  const writer = receiptWriter();
  const root = await mkdtemp(path.join(os.tmpdir(), "acos-receipt-directory-"));
  try {
    await writeFile(path.join(root, "preserved.txt"), "preserved");
    await assert.rejects(writer(root, "replacement"), { code: "EEXIST" });
    assert.deepEqual(await readdir(root), ["preserved.txt"]);
    assert.equal(
      await readFile(path.join(root, "preserved.txt"), "utf8"),
      "preserved",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("owned daemon startup evidence survives cleanup without publishing its output or private home", async () => {
  const capture = Reflect.get(smoke, "captureOwnedOllamaStartupEvidence") as
    ((supervisor: ProcessSupervisor) => Record<string, unknown>) | undefined;
  assert.equal(
    typeof capture,
    "function",
    "bounded startup evidence is missing",
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "acos-startup-evidence-"));
  const supervisor = new ProcessSupervisor({
    runId: path.basename(root),
    gracefulStopMs: 100,
    logLimitBytes: 65536,
  });
  const privateMarker = "owned-fixture-private-key-value";
  const script = [
    `console.error(${JSON.stringify("private home " + root + " secret " + privateMarker)});`,
    "console.error('time=2026-10-10T00:00:00Z level=INFO source=routes.go:1666 msg=\"Listening on 127.0.0.1:54321 (version 0.18.0)\"');",
    "console.error('time=2026-10-10T00:00:00Z level=INFO source=runner.go:63 msg=\"discovering available GPUs...\"');",
    "console.error('time=2026-10-10T00:00:00Z level=INFO source=server.go:430 msg=\"starting runner\"');",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  try {
    supervisor.start({
      name: "owned-ollama",
      command: process.execPath,
      args: ["-e", script],
      cwd: root,
      env: createOllamaSmokeEnvironment(
        process.env,
        root,
        "127.0.0.1:54321",
        "http://127.0.0.1:54322",
      ),
    });
    await supervisor.waitUntilReady(
      () =>
        supervisor
          .logs("owned-ollama")
          .stderr.includes('msg="starting runner"'),
      { timeoutMs: 5000, label: "Owned startup evidence fixture" },
    );
    const beforeCleanup = capture!(supervisor);
    assert.deepEqual(beforeCleanup, {
      captured: true,
      runtime: { running: true, exitCode: null, signal: null },
      milestones: {
        listenerAnnounced: true,
        gpuDiscoveryStarted: true,
        runnerStarted: true,
        gpuDiscoveryCompleted: false,
      },
      runnerDetails: {
        listenerAnnounced: false,
        dummyModelInitialized: false,
        deviceInfoGathered: false,
        metalDeviceEnumerated: false,
        embeddedMetalLibrarySelected: false,
        metalLibraryLoaded: false,
        metalSourceCompiled: false,
        discoveryFailed: false,
      },
    });
    assert.ok(!JSON.stringify(beforeCleanup).includes(privateMarker));
    assert.ok(!JSON.stringify(beforeCleanup).includes(root));
    await supervisor.kill("owned-ollama");
    assert.equal(supervisor.snapshot("owned-ollama")?.running, false);
    assert.deepEqual(beforeCleanup.runtime, {
      running: true,
      exitCode: null,
      signal: null,
    });
    const afterCleanup = capture!(supervisor);
    assert.equal((afterCleanup.runtime as { running: boolean }).running, false);
    assert.deepEqual(afterCleanup.milestones, beforeCleanup.milestones);
    assert.deepEqual(afterCleanup.runnerDetails, beforeCleanup.runnerDetails);
  } finally {
    await supervisor.kill("owned-ollama");
    await rm(root, { recursive: true });
  }
});

test("pinned child runner phases retain only booleans and no private log data", () => {
  const privateMarker = "private-fixture-token-and-home";
  const output = [
    `private config ${privateMarker}`,
    "2026/10/10 22:00:00 Server listening on 127.0.0.1:54321",
    'time=2026-10-10T22:00:00Z level=DEBUG source=runner.go:1389 msg="dummy model load took" duration=1s',
    'time=2026-10-10T22:00:00Z level=DEBUG source=runner.go:1394 msg="gathering device infos took" duration=1s',
    `ggml_metal_device_init: GPU name: ${privateMarker}`,
    "ggml_metal_library_init: using embedded metal library",
    "ggml_metal_library_init: loaded in 1.234 sec",
    "ggml_metal_library_init_from_source: compiled in 0.123 sec",
    `time=2026-10-10T22:00:00Z level=INFO source=runner.go:464 msg="failure during GPU discovery" error="${privateMarker}"`,
  ].join("\n");
  const captured = smoke.captureOwnedOllamaStartupEvidence({
    snapshot: () => ({
      name: "owned-ollama",
      pid: 12345,
      running: true,
      exitCode: null,
      signal: null,
    }),
    logs: () => ({ stdout: "", stderr: output }),
  });
  assert.deepEqual(Reflect.get(captured, "runnerDetails"), {
    listenerAnnounced: true,
    dummyModelInitialized: true,
    deviceInfoGathered: true,
    metalDeviceEnumerated: true,
    embeddedMetalLibrarySelected: true,
    metalLibraryLoaded: true,
    metalSourceCompiled: true,
    discoveryFailed: true,
  });
  assert.ok(!JSON.stringify(captured).includes(privateMarker));
  assert.ok(!JSON.stringify(captured).includes("54321"));
});

test("runner evidence does not infer phases from unrelated or incomplete text", () => {
  const captured = smoke.captureOwnedOllamaStartupEvidence({
    snapshot: () => ({
      name: "owned-ollama",
      pid: 12345,
      running: false,
      exitCode: 1,
      signal: null,
    }),
    logs: () => ({
      stdout: "Server listening on an unrelated service\n",
      stderr:
        'source=unrelated.go:1 msg="dummy model load took"\n' +
        "ggml_metal_library_init: error compiling source\n" +
        "ggml_metal_library_init_from_source: compiled in unknown sec\n",
    }),
  });
  assert.deepEqual(Reflect.get(captured, "runnerDetails"), {
    listenerAnnounced: false,
    dummyModelInitialized: false,
    deviceInfoGathered: false,
    metalDeviceEnumerated: false,
    embeddedMetalLibrarySelected: false,
    metalLibraryLoaded: false,
    metalSourceCompiled: false,
    discoveryFailed: false,
  });
});

test("startup evidence reports an unstarted daemon without reading unrelated output", () => {
  const capture = Reflect.get(smoke, "captureOwnedOllamaStartupEvidence") as
    | ((supervisor: Pick<ProcessSupervisor, "snapshot" | "logs">) => unknown)
    | undefined;
  assert.equal(
    typeof capture,
    "function",
    "unstarted daemon evidence is missing",
  );
  assert.deepEqual(
    capture!({
      snapshot: () => undefined,
      logs: () => {
        throw new Error("Unrelated output must not be read");
      },
    }),
    { captured: false },
  );
});

test("extractor termination failure closes the peer but cannot remove the owned home", async () => {
  const killed: string[] = [];
  let peerClosed = false,
    homeRemoved = false;
  await assert.rejects(
    runOwnedOllamaExtraction(
      {
        start: () => ({
          name: "owned-extractor",
          pid: 12345,
          running: true,
          exitCode: null,
          signal: null,
        }),
        snapshot: () => ({
          name: "owned-extractor",
          pid: 12345,
          running: true,
          exitCode: null,
          signal: null,
        }),
      },
      { command: "owned-fixture-command" },
      1,
    ),
    /owned_extraction_timeout/,
  );
  const cleanup = await cleanupOwnedOllama({
    stopRuntime: () =>
      stopOwnedOllamaProcesses({
        kill: async (name) => {
          killed.push(name);
          if (name === "owned-extractor")
            throw new Error("fixture timed-out extraction tree is still live");
        },
        snapshots: () => [
          {
            name: "owned-extractor",
            pid: 12345,
            running: true,
            exitCode: null,
            signal: null,
          },
        ],
      }),
    stopPeer: async () => {
      peerClosed = true;
      return true;
    },
    removeHome: async () => {
      homeRemoved = true;
      return true;
    },
  });
  assert.equal(peerClosed, true);
  assert.equal(homeRemoved, false);
  assert.ok(killed.includes("owned-extractor"));
  assert.equal(cleanup.runtimeStopped, false);
  assert.equal(cleanup.ownedHomeRemoved, false);
});

test("native execution refuses relative paths, existing receipts and non-pinned archives before creating a runtime", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "acos-ollama-invalid-input-"),
  );
  try {
    const archive = path.join(root, "invalid-archive.zip");
    const output = path.join(root, "existing.json");
    await writeFile(archive, "not an executable archive");
    await writeFile(output, "preserved receipt");
    await assert.rejects(
      runOllamaLocalBoundarySmoke("relative.zip", output),
      /absolute_smoke_paths_required/,
    );
    await assert.rejects(
      runOllamaLocalBoundarySmoke(archive, output),
      /new_receipt_path_required/,
    );
    await assert.rejects(
      runOllamaLocalBoundarySmoke(archive, path.join(root, "new.json")),
      /pinned_archive_size_mismatch/,
    );
    assert.equal(await readFile(output, "utf8"), "preserved receipt");
    assert.deepEqual((await readdir(root)).sort(), [
      "existing.json",
      "invalid-archive.zip",
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("failed runtime cleanup still closes the owned peer and preserves the private home", async () => {
  const calls: string[] = [];
  const cleanup = await cleanupOwnedOllama({
    stopRuntime: async () => {
      calls.push("runtime");
      throw new Error("fixture kill failure");
    },
    stopPeer: async () => {
      calls.push("peer");
      return true;
    },
    removeHome: async () => {
      calls.push("home");
      return true;
    },
  });
  assert.deepEqual(calls, ["runtime", "peer"]);
  assert.deepEqual(cleanup, {
    runtimeStopped: false,
    peerStopped: true,
    ownedHomeRemoved: false,
  });
});

test("a failed home removal cannot produce a passed cleanup receipt", async () => {
  const cleanup = await cleanupOwnedOllama({
    stopRuntime: async () => true,
    stopPeer: async () => true,
    removeHome: async () => {
      throw new Error("fixture remove failure");
    },
  });
  assert.deepEqual(cleanup, {
    runtimeStopped: true,
    peerStopped: true,
    ownedHomeRemoved: false,
  });
});

test("released-server probes isolate every inherited provider, home and proxy setting", () => {
  const home = path.join(os.tmpdir(), "acos-ollama-boundary-owned");
  const environment = createOllamaSmokeEnvironment(
    {
      OPENAI_API_KEY: "fixture-secret",
      OLLAMA_API_KEY: "fixture-secret",
      OLLAMA_HOST: "https://outside.invalid",
      OLLAMA_DEBUG: "untrusted-inherited-setting",
      OLLAMA_MODELS: "/personal/models",
      USERPROFILE: "/personal/profile",
      HTTPS_PROXY: "http://outside.invalid",
      SystemRoot: "C:\\Windows",
    },
    home,
    "127.0.0.1:54321",
    "http://127.0.0.1:54322",
  );
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.OLLAMA_API_KEY, undefined);
  assert.equal(environment.OLLAMA_NO_CLOUD, "1");
  assert.equal(environment.OLLAMA_DEBUG, "2");
  assert.equal(environment.HOME, home);
  assert.equal(environment.USERPROFILE, home);
  assert.equal(environment.OLLAMA_MODELS, path.join(home, "models"));
  assert.equal(environment.OLLAMA_HOST, "127.0.0.1:54321");
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:54322");
});

test("an auth failure, cloud rejection or successful completion cannot prove a local selector rejected an existing remote alias", () => {
  requireLocalAliasRejection(
    404,
    { error: "model 'acos-boundary:latest:local' not found" },
    "acos-boundary:latest:local",
  );
  for (const status of [200, 400, 401, 403, 500]) {
    assert.throws(() =>
      requireLocalAliasRejection(
        status,
        { error: "private-error" },
        "acos-boundary:latest:local",
      ),
    );
  }
  assert.throws(() =>
    requireLocalAliasRejection(
      404,
      { error: "unrelated route missing" },
      "acos-boundary:latest:local",
    ),
  );
  requireCloudDisabledRejection(403, {
    error: "ollama cloud is disabled: remote model inference is unavailable",
  });
  assert.throws(() =>
    requireCloudDisabledRejection(401, { error: "sign in required" }),
  );
});

async function ownedPeer(
  options: {
    version?: string;
    ignoredCompatibilitySelector?: boolean;
    redirect?: string;
  } = {},
) {
  const requests: { path: string; model?: string }[] = [];
  const peer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    requests.push({ path: request.url!, model: body.model });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/version")
      return response.end(
        JSON.stringify({ version: options.version ?? "0.18.0" }),
      );
    if (options.redirect) {
      response.writeHead(307, { Location: options.redirect });
      return response.end();
    }
    if (request.url === "/api/tags")
      return response.end(
        JSON.stringify({
          models: [
            {
              name: "acos-boundary:latest",
              remote_host: "http://127.0.0.1:54322",
              remote_model: "acos-owned-remote:latest",
            },
          ],
        }),
      );
    if (request.url === "/api/show") {
      response.statusCode = 403;
      return response.end(
        JSON.stringify({
          error:
            "ollama cloud is disabled: remote model details are unavailable",
        }),
      );
    }
    if (
      options.ignoredCompatibilitySelector &&
      request.url === "/v1/chat/completions"
    )
      return response.end(
        JSON.stringify({
          choices: [{ message: { content: "must not count as private" } }],
        }),
      );
    const local = body.model === "acos-boundary:latest:local";
    response.statusCode = local ? 404 : 403;
    return response.end(
      JSON.stringify({
        error: local
          ? `model '${body.model}' not found`
          : "ollama cloud is disabled: remote model inference is unavailable",
      }),
    );
  });
  await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
  const address = peer.address();
  assert.ok(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      peer.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        peer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("the released-server proof checks an existing remote alias across actual local and compatibility transports", async () => {
  const peer = await ownedPeer();
  try {
    const result = await probeReleasedOllamaBoundary(
      peer.origin,
      "acos-boundary:latest",
      "http://127.0.0.1:54322",
    );
    assert.equal(result.version, "0.18.0");
    assert.equal(result.localRejections, 2);
    assert.equal(result.cloudDisabledRejections, 3);
    assert.equal(
      peer.requests.filter((row) => row.model?.endsWith(":local")).length,
      3,
    );
  } finally {
    await peer.close();
  }
});

test("a supported-looking server that ignores the compatibility local selector cannot pass", async () => {
  const peer = await ownedPeer({ ignoredCompatibilitySelector: true });
  try {
    await assert.rejects(
      probeReleasedOllamaBoundary(
        peer.origin,
        "acos-boundary:latest",
        "http://127.0.0.1:54322",
      ),
      /local_selector_not_enforced/,
    );
  } finally {
    await peer.close();
  }
});

test("an older server is rejected before any model request", async () => {
  const peer = await ownedPeer({ version: "0.17.9" });
  try {
    await assert.rejects(
      probeReleasedOllamaBoundary(
        peer.origin,
        "acos-boundary:latest",
        "http://127.0.0.1:54322",
      ),
      /pinned_runtime_version_mismatch/,
    );
    assert.deepEqual(
      peer.requests.map((row) => row.path),
      ["/api/version"],
    );
  } finally {
    await peer.close();
  }
});

test("the native privacy probe cannot follow a model redirect to another peer", async () => {
  const target = await ownedPeer();
  const source = await ownedPeer({ redirect: target.origin + "/api/tags" });
  try {
    await assert.rejects(
      probeReleasedOllamaBoundary(
        source.origin,
        "acos-boundary:latest",
        "http://127.0.0.1:54322",
      ),
    );
    assert.equal(target.requests.length, 0);
  } finally {
    await source.close();
    await target.close();
  }
});
