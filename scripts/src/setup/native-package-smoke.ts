import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { reserveLoopbackPorts } from "../endurance/native-postgres-harness";
import { createControlledArithmeticPeer } from "../testing/controlled-arithmetic-peer";
import { readNativeDistribution } from "./native-distribution";
import { proveDatabaseBackup } from "./backup-restore-proof";

// Release-host integration proof. Infrastructure comes only from the extracted
// archive. The test driver/Python run on the build host, never on an end user's
// first launch. A fixed peer proves the job plumbing, not model intelligence.
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i],
    value = process.argv[i + 1];
  assert.ok(
    ["--archive", "--evidence", "--local-endpoint", "--local-model"].includes(
      flag,
    ) &&
      value &&
      !options.has(flag),
  );
  options.set(flag, value);
}
assert.ok(options.get("--archive") && options.get("--evidence"));
assert.equal(options.has("--local-endpoint"), options.has("--local-model"));
const live = options.has("--local-endpoint");
const source = fileURLToPath(new URL("../../..", import.meta.url));
const archive = await realpath(path.resolve(options.get("--archive")!));
const evidencePath = path.resolve(options.get("--evidence")!);
const owned = await mkdtemp(
  path.join(await realpath(tmpdir()), "acos-package-proof-"),
);
const packageRoot = path.join(owned, "Fresh install Ω");
const parent = path.join(owned, "Private data Ω");
const proof: Record<string, unknown> = {
  schemaVersion: 1,
  accepted: false,
  cleanupVerified: false,
  startedAt: new Date().toISOString(),
  target: `${process.platform}-${process.arch}`,
  archiveSha256: createHash("sha256")
    .update(await readFile(archive))
    .digest("hex"),
  modelEvidence: live
    ? "real local model"
    : "controlled loopback fixture; simulated token usage",
  scope:
    "Fresh archive, bundled Node/PostgreSQL, migrations, API, two workers, first finite job, restart and backup/restore on this matching host. No physical phone, long soak or general model-quality claim.",
};
let child: ChildProcess | undefined;
let childLog = "";
let instance: string | undefined;
let appUrl: string | undefined;
let peer:
  Awaited<ReturnType<typeof createControlledArithmeticPeer>> | undefined;
let dbUrl: URL | undefined;
let operatorToken: string | undefined;

function hostEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "LANG",
    "LC_ALL",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[key]) result[key] = process.env[key];
  result.PATH =
    process.platform === "win32"
      ? `${process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows"}\\System32`
      : "/usr/bin:/bin:/usr/sbin:/sbin";
  return result;
}
const environment = hostEnvironment();
const run = (
  command: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
  timeoutMs = 60_000,
) =>
  executeBoundedCommand({
    command,
    args,
    cwd: packageRoot,
    environment: { ...environment, ...extra },
    timeoutMs,
    maxBufferBytes: 1024 * 1024,
  });
const node = () =>
  path.join(
    packageRoot,
    process.platform === "win32"
      ? "runtime/node/node.exe"
      : "runtime/node/bin/node",
  );
const postgres = (name: string) =>
  path.join(
    packageRoot,
    "runtime/postgres/bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("package_shutdown_timeout")),
      45_000,
    );
    child!.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("package_shutdown_failed"));
    });
  });
  child.send({ action: "stop" });
  await stopped;
  child = undefined;
}
async function startPackage() {
  assert.equal(child, undefined);
  childLog = "";
  const script = `import {launchSetup} from ${JSON.stringify(pathToFileURL(path.join(packageRoot, "scripts/src/setup/bootstrap.mjs")).href)};
const handle = await launchSetup(${JSON.stringify(["--data-dir", parent, "--no-browser"])});
process.on('message', async message => { if(message?.action !== 'stop') return; try { await handle.session?.close(); await handle.executor.stopNative(); process.disconnect(); process.exit(0); } catch { process.exit(1); } });
process.send({setupUrl:handle.session?.url ?? null});`;
  const launched = spawn(node(), ["--input-type=module", "-e", script], {
    cwd: packageRoot,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child = launched;
  for (const stream of [launched.stdout, launched.stderr])
    stream?.on("data", (data: Buffer) => {
      childLog = (childLog + data.toString()).slice(-128 * 1024);
    });
  return new Promise<{ setupUrl: string | null }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("package_start_timeout")),
      240_000,
    );
    launched.once("message", (message) => {
      clearTimeout(timer);
      resolve(message as { setupUrl: string | null });
    });
    launched.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    launched.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`package_start_exit_${code}`));
    });
  });
}
async function request<T = Record<string, unknown>>(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  assert.ok(appUrl && operatorToken);
  const response = await fetch(appUrl + "/api" + route, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${operatorToken}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.ok, true, `${method} ${route}: ${response.status}`);
  return (await response.json()) as T;
}
try {
  await executeBoundedCommand({
    command:
      process.env.PYTHON ??
      (process.platform === "win32" ? "python" : "python3"),
    args: [
      path.join(source, "scripts/native-package-archive.py"),
      "extract-package",
      archive,
      packageRoot,
    ],
    cwd: source,
    environment: process.env,
    timeoutMs: 120_000,
    maxBufferBytes: 1024 * 1024,
  });
  const manifest = await readNativeDistribution(packageRoot);
  assert.ok(manifest);
  proof.commit = manifest.commit;
  proof.inventoryFiles = manifest.files.length;
  proof.nodeVersion = manifest.nodeVersion;
  proof.postgresVersion = manifest.postgresVersion;
  assert.equal(
    (await run(node(), ["--version"])).stdout.trim(),
    `v${manifest.nodeVersion}`,
  );
  // Use the shipped launcher for its read-only check with no developer tools on PATH.
  const checked =
    process.platform === "win32"
      ? await run(process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe", [
          "/d",
          "/c",
          "START.cmd",
          "--check",
        ])
      : await run(path.join(packageRoot, "START.command"), ["--check"]);
  assert.match(checked.stdout, /Included native runtime/u);
  assert.doesNotMatch(checked.stdout, /pnpm install/u);
  if (!live) peer = await createControlledArithmeticPeer();
  const endpoint = options.get("--local-endpoint") ?? peer!.endpoint;
  const model = options.get("--local-model") ?? peer!.model;
  const launched = await startPackage();
  assert.ok(launched.setupUrl);
  const privateUrl = new URL(launched.setupUrl);
  const sessionToken = privateUrl.hash.slice(1);
  const setup = async <T = Record<string, unknown>>(
    route: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const response = await fetch(privateUrl.origin + "/api/" + route, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${sessionToken}`,
        origin: privateUrl.origin,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.ok, true, `setup ${route}: ${response.status}`);
    return (await response.json()) as T;
  };
  const capabilities = await setup<{
    native: { ready: boolean; managedDatabase: boolean };
  }>("capabilities");
  assert.equal(capabilities.native.ready, true);
  assert.equal(capabilities.native.managedDatabase, true);
  const [port] = await reserveLoopbackPorts(1);
  const plan = await setup<{ id: string; steps: string[] }>("plan", "POST", {
    mode: "native",
    locale: "en",
    port,
    accessMode: "read_only",
    provider: "ollama",
    phoneAccess: "local",
    toolPacks: ["data", "documents"],
  });
  assert.ok(!plan.steps.includes("build_application"));
  await setup("install", "POST", {
    planId: plan.id,
    credentials: { ollamaUrl: endpoint },
  });
  let state: Record<string, unknown> = {};
  const deadline = Date.now() + 240_000;
  do {
    state = await setup("state");
    if (state.phase === "complete" || state.phase === "failed") break;
    await delay(500);
  } while (Date.now() < deadline);
  assert.equal(
    state.phase,
    "complete",
    "Fresh package installation must complete",
  );
  proof.installationSteps = state.completedSteps;
  appUrl = String(state.url);
  operatorToken = (
    await setup<{ operatorToken: string }>("connection", "POST", {})
  ).operatorToken;
  const pointer = JSON.parse(
    await readFile(path.join(parent, "native-launch.json"), "utf8"),
  );
  instance = pointer.directory;
  assert.ok(instance);
  dbUrl = new URL(
    await readFile(path.join(instance, "secrets/database_url"), "utf8"),
  );
  assert.equal((await fetch(appUrl + "/api/tasks")).status, 401);
  assert.equal((await fetch(appUrl)).status, 200);
  const agents =
    await request<Array<{ id: number; parentAgentId: number | null }>>(
      "/agents",
    );
  const owner = agents.find((agent) => agent.parentAgentId === null);
  assert.ok(owner);
  await request(`/agents/${owner.id}`, "PATCH", {
    modelMode: "manual",
    modelId: "ollama:" + model,
  });
  const brief = live
    ? "Use calculate to add 58.5 and 14.5. Report the total in EUR and complete_task. Do not browse, create agents or delegate."
    : "Use calculate to multiply 17 by 23. Report 391 and complete_task. Do not browse, create agents or delegate.";
  const task = await request<{ id: number }>("/tasks", "POST", {
    requestId: randomUUID(),
    title: "First job from a fresh native archive",
    brief,
    ownerAgentId: owner.id,
    autonomyMode: "finite",
    priority: "normal",
    completionRequirements: [{ kind: "tool_succeeded", tool: "calculate" }],
  });
  let finished: Record<string, unknown> = {};
  const taskDeadline = Date.now() + (live ? 20 * 60_000 : 90_000);
  do {
    finished = await request(`/tasks/${task.id}`);
    if (
      ["completed", "failed", "blocked", "cancelled"].includes(
        String(finished.status),
      )
    )
      break;
    await delay(live ? 3000 : 500);
  } while (Date.now() < taskDeadline);
  assert.equal(finished.status, "completed");
  assert.match(String(finished.resultSummary), live ? /73/u : /391/u);
  assert.equal(finished.lastModelId, "ollama:" + model);
  assert.equal(finished.modelFallbackCount, 0);
  assert.equal((await request<unknown[]>("/agents")).length, agents.length);
  proof.firstTask = Object.fromEntries(
    [
      "status",
      "resultSummary",
      "lastModelId",
      "modelFallbackCount",
      "tokensUsed",
      "estimatedCostUsd",
    ].map((key) => [key, finished[key]]),
  );
  if (peer) {
    assert.deepEqual(peer.unexpected, []);
    assert.deepEqual(
      peer.requests.filter((item) => item.kind).map((item) => item.kind),
      ["calculate", "complete_task", "judge"],
    );
  }
  const connectionArgs = [
    "-h",
    "127.0.0.1",
    "-p",
    dbUrl.port,
    "-U",
    dbUrl.username,
  ];
  const durability = await run(
    postgres("psql"),
    [
      ...connectionArgs,
      "-d",
      "postgres",
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SHOW fsync; SHOW full_page_writes; BEGIN; CREATE EXTENSION dblink; CREATE EXTENSION postgres_fdw; ROLLBACK;",
    ],
    { PGPASSWORD: decodeURIComponent(dbUrl.password) },
  );
  assert.deepEqual(durability.stdout.trim().split(/\r?\n/u).slice(0, 2), [
    "on",
    "on",
  ]);
  proof.durableDatabaseAndPrivateModules = true;
  proof.backup = await proveDatabaseBackup({
    database: "postgres",
    dumpPath: path.join(owned, "first-job.dump"),
    connectionArgs,
    command: (name, args) =>
      run(postgres(name), args, {
        PGPASSWORD: decodeURIComponent(dbUrl!.password),
      }),
  });
  await stopChild();
  await assert.rejects(access(path.join(instance, "database/postmaster.pid")));
  const resumed = await startPackage();
  assert.equal(resumed.setupUrl, null);
  const sameTask = await request(`/tasks/${task.id}`);
  assert.equal(sameTask.status, "completed");
  assert.equal(sameTask.resultSummary, finished.resultSummary);
  assert.equal(
    await readFile(path.join(instance, "secrets/operator_auth_token"), "utf8"),
    operatorToken,
  );
  proof.restartPreservedTaskAndIdentity = true;
  await stopChild();
  await assert.rejects(access(path.join(instance, "database/postmaster.pid")));
  // Relocation and launched infrastructure must leave packaged bytes unchanged.
  assert.deepEqual(await readNativeDistribution(packageRoot), manifest);
  proof.cleanupVerified = true;
  proof.accepted = true;
} catch (error) {
  proof.error =
    error instanceof Error ? error.message : "package_acceptance_failed";
  // The retained diagnostic log is private and may contain the short-lived setup
  // URL. Public receipts deliberately exclude it and the private data paths.
  await writeFile(path.join(owned, "private-launcher.log"), childLog, {
    mode: 0o600,
  });
  process.exitCode = 1;
} finally {
  try {
    await stopChild();
    if (instance)
      await assert.rejects(
        access(path.join(instance, "database/postmaster.pid")),
      );
    proof.cleanupVerified = true;
  } catch {
    proof.accepted = false;
    proof.cleanupVerified = false;
    proof.cleanupError = "owned_package_process_shutdown_failed";
    process.exitCode = 1;
  }
  await peer?.close();
  proof.finishedAt = new Date().toISOString();
  await writeFile(evidencePath, JSON.stringify(proof, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(proof));
}
