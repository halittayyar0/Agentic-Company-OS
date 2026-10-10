import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortListener } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ProcessSupervisor,
  type ManagedProcessSpec,
} from "./endurance/process-supervisor";
import { sha256ExactFile } from "./endurance/native-runtime-provenance";

const VERSION = "0.18.0";
const ALIAS = "acos-boundary:latest";
const REMOTE_MODEL = "acos-owned-remote:latest";
// Published full-archive digests, not an installed person's Ollama executable.
const pins = {
  "win32-x64": {
    sha256: "be04d551b7771bd2933cdb50eff2d153f83655001de996732e699937c70a44eb",
    bytes: 2008188352,
    entry: "ollama.exe",
  },
  "win32-arm64": {
    sha256: "ceb85ed94233a74e5f5174603568173cdd35bd609d819a5ecc4831623bb783a3",
    bytes: 23280904,
    entry: "ollama.exe",
  },
  "darwin-x64": {
    sha256: "a0c97593a88482971e39db90113d65f1ed2a234067363a9733f15aa6faebd54d",
    bytes: 73390191,
    entry: "ollama",
  },
  "darwin-arm64": {
    sha256: "a0c97593a88482971e39db90113d65f1ed2a234067363a9733f15aa6faebd54d",
    bytes: 73390191,
    entry: "ollama",
  },
  "linux-x64": {
    sha256: "e364aedc9a991cbf36f704baa807a04f432d46e32265b783e7dec9ce0336af88",
    bytes: 2016916432,
    entry: "bin/ollama",
  },
  "linux-arm64": {
    sha256: "73ce31231f7255de6dc48fb5e8cdfa3edb422a6678b169f4f1d4cfdf7998e123",
    bytes: 1302399587,
    entry: "bin/ollama",
  },
} as const;

function loopbackOrigin(value: string): string {
  const url = new URL(value);
  assert.ok(
    url.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "owned_loopback_origin_required",
  );
  return url.origin;
}

export function createOllamaSmokeEnvironment(
  base: NodeJS.ProcessEnv,
  home: string,
  listener: string,
  proxy: string,
): NodeJS.ProcessEnv {
  assert.ok(path.isAbsolute(home), "owned_home_required");
  loopbackOrigin("http://" + listener);
  loopbackOrigin(proxy);
  // The existing supervisor merges its environment; undefined clears every
  // inherited name, including case aliases, before assigning this allowlist.
  const cleared = Object.fromEntries(
    Object.keys(base).map((key) => [key, undefined]),
  );
  return {
    ...cleared,
    SystemRoot: base.SystemRoot ?? base.SYSTEMROOT,
    WINDIR: base.WINDIR ?? base.SystemRoot ?? base.SYSTEMROOT,
    PATH:
      process.platform === "win32"
        ? path.join(
            base.SystemRoot ?? base.SYSTEMROOT ?? "C:\\Windows",
            "System32",
          )
        : "/usr/bin:/bin",
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "config"),
    LOCALAPPDATA: path.join(home, "local"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    TMP: path.join(home, "tmp"),
    TEMP: path.join(home, "tmp"),
    TMPDIR: path.join(home, "tmp"),
    OLLAMA_HOST: listener,
    OLLAMA_MODELS: path.join(home, "models"),
    OLLAMA_NO_CLOUD: "1",
    OLLAMA_NOHISTORY: "1",
    OLLAMA_KEEP_ALIVE: "0",
    OLLAMA_MAX_LOADED_MODELS: "1",
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    NO_PROXY: "127.0.0.1,localhost,::1",
  };
}

function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) return undefined;
  const error = body.error;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return undefined;
}
export function requireLocalAliasRejection(
  status: number,
  body: unknown,
  selector: string,
): void {
  assert.ok(
    status === 404 && errorMessage(body) === `model '${selector}' not found`,
    "local_selector_not_enforced",
  );
}
export function requireCloudDisabledRejection(
  status: number,
  body: unknown,
): void {
  assert.ok(
    status === 403 &&
      errorMessage(body)?.startsWith("ollama cloud is disabled"),
    "cloud_disable_not_enforced",
  );
}

export async function probeReleasedOllamaBoundary(
  origin: string,
  alias: string,
  remoteOrigin: string,
  observe?: (row: { route: string; status: number; kind: string }) => void,
) {
  origin = loopbackOrigin(origin);
  remoteOrigin = loopbackOrigin(remoteOrigin);
  assert.match(
    alias,
    /^[a-z0-9][a-z0-9_-]{0,63}:latest$/u,
    "owned_alias_required",
  );
  const request = async (route: string, body?: object) => {
    const response = await fetch(origin + route, {
      method: body ? "POST" : "GET",
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    assert.ok(text.length <= 65536, "bounded_native_response_required");
    const result = { status: response.status, body: JSON.parse(text) };
    const message = errorMessage(result.body);
    observe?.({
      route,
      status: response.status,
      kind: message?.startsWith("ollama cloud is disabled")
        ? "cloud_disabled"
        : message?.includes("not found")
          ? "not_found"
          : response.ok
            ? "ok"
            : "unexpected",
    });
    return result;
  };
  const version = await request("/api/version");
  assert.ok(
    version.status === 200 && version.body.version === VERSION,
    "pinned_runtime_version_mismatch",
  );
  const tags = await request("/api/tags");
  assert.ok(
    tags.status === 200 &&
      tags.body.models?.some(
        (model: {
          name?: string;
          remote_host?: string;
          remote_model?: string;
        }) =>
          model.name === alias &&
          model.remote_host === remoteOrigin &&
          model.remote_model === REMOTE_MODEL,
      ),
    "owned_remote_alias_not_discovered",
  );
  const selector = alias + ":local";
  // v0.18.0 GetModelInfo refuses disabled cloud metadata before ShowHandler's
  // local-selector check. Chat routes enforce the selector directly.
  const show = await request("/api/show", { model: selector });
  requireCloudDisabledRejection(show.status, show.body);
  for (const route of ["/api/chat", "/v1/chat/completions"]) {
    const response = await request(route, {
      model: selector,
      stream: false,
      messages: [{ role: "user", content: "offline-boundary-probe" }],
    });
    requireLocalAliasRejection(response.status, response.body, selector);
  }
  for (const model of [alias, alias + ":cloud"]) {
    const response = await request("/v1/chat/completions", {
      model,
      stream: false,
      messages: [{ role: "user", content: "offline-boundary-probe" }],
    });
    requireCloudDisabledRejection(response.status, response.body);
  }
  return { version: VERSION, localRejections: 2, cloudDisabledRejections: 3 };
}

export async function cleanupOwnedOllama(actions: {
  stopRuntime(): Promise<boolean>;
  stopPeer(): Promise<boolean>;
  removeHome(): Promise<boolean>;
}) {
  // A failed process cleanup must not strand the peer or remove a home that
  // a live process may still own. Keep failure data in the receipt, not errors.
  const attempt = async (action: () => Promise<boolean>) => {
    try {
      return await action();
    } catch {
      return false;
    }
  };
  const runtimeStopped = await attempt(actions.stopRuntime);
  const peerStopped = await attempt(actions.stopPeer);
  const ownedHomeRemoved =
    runtimeStopped && peerStopped ? await attempt(actions.removeHome) : false;
  return { runtimeStopped, peerStopped, ownedHomeRemoved };
}

export async function stopOwnedOllamaProcesses(
  supervisor: Pick<ProcessSupervisor, "kill" | "snapshots">,
) {
  const stopped = await Promise.allSettled([
    supervisor.kill("owned-ollama"),
    supervisor.kill("owned-extractor"),
  ]);
  return (
    stopped.every((result) => result.status === "fulfilled") &&
    supervisor.snapshots().every((item) => !item.running)
  );
}

export async function runOwnedOllamaExtraction(
  supervisor: Pick<ProcessSupervisor, "start" | "snapshot">,
  spec: Omit<ManagedProcessSpec, "name">,
  timeoutMs: number,
) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  supervisor.start({ ...spec, name: "owned-extractor" });
  const deadline = Date.now() + timeoutMs;
  while (supervisor.snapshot("owned-extractor")?.running) {
    assert.ok(Date.now() < deadline, "owned_extraction_timeout");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))),
    );
  }
  assert.equal(
    supervisor.snapshot("owned-extractor")?.exitCode,
    0,
    "owned_extraction_failed",
  );
}

export async function runOllamaLocalBoundarySmoke(
  archive: string,
  output: string,
) {
  assert.ok(
    path.isAbsolute(archive) && path.isAbsolute(output),
    "absolute_smoke_paths_required",
  );
  assert.ok(
    !(await lstat(output).catch(() => null)),
    "new_receipt_path_required",
  );
  const pin = pins[`${process.platform}-${process.arch}` as keyof typeof pins];
  assert.ok(pin, "unsupported_native_runtime_platform");
  assert.equal(
    (await lstat(archive)).size,
    pin.bytes,
    "pinned_archive_size_mismatch",
  );
  assert.equal(
    await sha256ExactFile(archive, "Pinned Ollama archive"),
    pin.sha256,
    "pinned_archive_digest_mismatch",
  );
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "acos-ollama-boundary-"));
  const rootIdentity = await realpath(root);
  const supervisor = new ProcessSupervisor({
    runId: path.basename(root),
    gracefulStopMs: 1000,
    logLimitBytes: 65536,
  });
  let peerStopped = false,
    runtimeStopped = false,
    ownedHomeRemoved = false,
    passed = false;
  let ownedRemoteRequests = 0,
    positiveControls = 0;
  let native:
    | {
        version: string;
        localRejections: number;
        cloudDisabledRejections: number;
      }
    | undefined;
  let binarySha256: string | undefined;
  let daemonPid: number | null = null;
  const observations: { route: string; status: number; kind: string }[] = [];
  const peer = createServer((request, response) => {
    if (request.url === "/owned-positive-control") positiveControls++;
    else ownedRemoteRequests++;
    response.writeHead(502);
    response.end("owned offline peer");
  });
  peer.on("connect", (_request, socket) => {
    ownedRemoteRequests++;
    socket.destroy();
  });
  try {
    for (const directory of [
      "models",
      "tmp",
      "config",
      "cache",
      "local",
      "bin",
    ])
      await mkdir(path.join(root, directory), { mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      peer.once("error", reject);
      peer.listen(0, "127.0.0.1", resolve);
    });
    const peerAddress = peer.address();
    assert.ok(peerAddress && typeof peerAddress !== "string");
    const remoteOrigin = `http://127.0.0.1:${peerAddress.port}`;
    const listener = createPortListener();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    const environment = createOllamaSmokeEnvironment(
      process.env,
      root,
      `127.0.0.1:${address.port}`,
      remoteOrigin,
    );
    const destination = path.join(root, "bin");
    if (process.platform === "win32") {
      // The full archive was byte-verified above. Extract its fixed daemon entry
      // with Windows' native tar, avoiding PowerShell/.NET initialization inside
      // the unchanged extraction window. Paths remain separate process arguments.
      await runOwnedOllamaExtraction(
        supervisor,
        {
          command: path.join(environment.SystemRoot!, "System32/tar.exe"),
          args: ["-xf", archive, "-C", destination, pin.entry],
          cwd: root,
          env: environment,
        },
        30000,
      );
    } else {
      await runOwnedOllamaExtraction(
        supervisor,
        {
          command: "/usr/bin/tar",
          args: ["-xf", archive, "-C", destination, pin.entry],
          cwd: root,
          env: environment,
        },
        180000,
      );
    }
    const binary = path.join(destination, pin.entry);
    if (process.platform === "win32") {
      const extracted = await lstat(binary);
      assert.ok(extracted.isFile() && extracted.size <= 134217728);
    }
    binarySha256 = await sha256ExactFile(binary, "Extracted pinned daemon");
    const config = Buffer.from(
      JSON.stringify({
        remote_host: remoteOrigin,
        remote_model: REMOTE_MODEL,
        capabilities: ["completion", "tools"],
        architecture: "amd64",
        os: "linux",
        rootfs: { type: "layers", diff_ids: [] },
      }),
    );
    const configDigest = createHash("sha256").update(config).digest("hex");
    const blobs = path.join(root, "models/blobs"),
      manifests = path.join(
        root,
        "models/manifests/registry.ollama.ai/library/acos-boundary",
      );
    await mkdir(blobs, { recursive: true, mode: 0o700 });
    await mkdir(manifests, { recursive: true, mode: 0o700 });
    await writeFile(path.join(blobs, "sha256-" + configDigest), config, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      path.join(manifests, "latest"),
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.docker.distribution.manifest.v2+json",
        config: {
          mediaType: "application/vnd.docker.container.image.v1+json",
          digest: "sha256:" + configDigest,
          size: config.length,
        },
        layers: [],
      }),
      { flag: "wx", mode: 0o600 },
    );
    await fetch(remoteOrigin + "/owned-positive-control", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(positiveControls, 1);
    daemonPid = supervisor.start({
      name: "owned-ollama",
      command: binary,
      args: ["serve"],
      cwd: root,
      env: environment,
    }).pid;
    await supervisor.waitUntilReady(
      async () => {
        assert.equal(
          supervisor.snapshot("owned-ollama")?.running,
          true,
          "owned_runtime_exited_before_readiness",
        );
        const response = await fetch(origin + "/api/version", {
          signal: AbortSignal.timeout(500),
          redirect: "error",
        });
        return response.ok;
      },
      { timeoutMs: 20000, intervalMs: 100, label: "Owned pinned Ollama" },
    );
    native = await probeReleasedOllamaBoundary(
      origin,
      ALIAS,
      remoteOrigin,
      (row) => observations.push(row),
    );
    await fetch(remoteOrigin + "/owned-positive-control", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(positiveControls, 2);
    assert.equal(
      ownedRemoteRequests,
      0,
      "unexpected_owned_remote_or_proxy_request",
    );
    assert.equal(
      await sha256ExactFile(binary, "Pinned daemon after probe"),
      binarySha256,
    );
    passed = true;
  } finally {
    ({ runtimeStopped, peerStopped, ownedHomeRemoved } =
      await cleanupOwnedOllama({
        stopRuntime: async () => {
          return stopOwnedOllamaProcesses(supervisor);
        },
        stopPeer: async () => {
          peer.closeAllConnections();
          if (peer.listening)
            await new Promise<void>((resolve, reject) =>
              peer.close((error) => (error ? reject(error) : resolve())),
            );
          return !peer.listening;
        },
        removeHome: async () => {
          // Delete only the freshly created root after resolving its exact identity.
          assert.equal(await realpath(root), rootIdentity);
          assert.equal(path.dirname(rootIdentity), parent);
          await rm(rootIdentity, { recursive: true });
          return !(await lstat(root).catch(() => null));
        },
      }));
    await writeFile(
      output,
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          passed: passed && runtimeStopped && peerStopped && ownedHomeRemoved,
          platform: process.platform,
          architecture: process.arch,
          archiveSha256: pin.sha256,
          archiveBytes: pin.bytes,
          binarySha256,
          daemonPid,
          native,
          observations,
          alias: ALIAS,
          remoteModel: REMOTE_MODEL,
          modelWeights: 0,
          ownedRemoteRequests,
          positiveControls,
          cleanup: {
            runtimeStopped,
            peerStopped,
            ownedHomeRemoved,
          },
          scope:
            "Pinned released-server selector/cloud-disable rejection against one owned remote alias and proxy, without model weights or a person's credentials. No successful inference, paid/account/physical-phone/24-hour proof or system-wide packet capture.",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  assert.ok(passed && runtimeStopped && peerStopped && ownedHomeRemoved);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  assert.equal(
    process.env.ACOS_OLLAMA_BOUNDARY_SMOKE,
    "1",
    "explicit_owned_smoke_required",
  );
  const [archive, output] = process.argv.slice(2);
  assert.ok(
    archive && output && process.argv.length === 4,
    "usage: pinned-archive-path new-receipt-path",
  );
  await runOllamaLocalBoundarySmoke(
    path.resolve(archive),
    path.resolve(output),
  );
  console.log(
    "Pinned Ollama local-boundary smoke passed; owned runtime and home removed.",
  );
}
