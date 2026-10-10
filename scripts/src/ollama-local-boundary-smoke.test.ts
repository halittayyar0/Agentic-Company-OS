import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
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
