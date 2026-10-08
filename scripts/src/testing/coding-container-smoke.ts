import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertCodingContainerIdentity,
  assertNativeTestSummary,
  codingContainerArguments,
  isMissingOwnedContainer,
  assertCodingCompose,
} from "./coding-container-contract";
import { buildContainerDeployment } from "../setup/deployment";
import { planInstallation } from "../setup/plan";

const run = promisify(execFile);
const ENTRIES = [
  ["vm/linux-owned-namespace.test.ts", "namespace.test.mjs"],
  ["vm/linux-owned-launcher.test.ts", "launcher.test.mjs"],
  ["codex-task-linux-process.test.ts", "factory.test.mjs"],
  ["codex-task-linux-native.test.ts", "codex-native.test.mjs"],
  ["vm/testing/linux-launcher-owner.ts", "launcher-owner.mjs"],
] as const;

/** Offline native proof only. Never starts a model turn, account login or image pull. */
export async function runCodingContainerSmoke(image: string) {
  assert.equal(
    process.env.ACOS_CODING_CONTAINER_SMOKE,
    "1",
    "explicit_coding_container_gate_required",
  );
  const workspace = fileURLToPath(new URL("../../..", import.meta.url));
  const temporary = await realpath(tmpdir());
  const directory = await mkdtemp(
    path.join(temporary, "acos-coding-container-"),
  );
  const fixture = path.join(directory, "fixture");
  await mkdir(fixture, { mode: 0o755 });
  // Only compiled source is readable through this bind. Evidence stays private.
  await chmod(directory, 0o755);
  const name = `acos-proof-${randomUUID()}`;
  const profile = path.join(workspace, "deploy/coding-seccomp.json");
  const docker = async (args: string[], timeout = 30_000) =>
    run("docker", args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
  const git = async (args: string[]) =>
    (
      await run("git", args, {
        cwd: workspace,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout;
  const sourceIdentity = async () => {
    const commit = (await git(["rev-parse", "HEAD"])).trim();
    const files = (
      await git([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ])
    )
      .split("\0")
      .filter(Boolean)
      .sort();
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file + "\0");
      hash.update(await readFile(path.join(workspace, file)));
    }
    return { commit, workingSourceSha256: hash.digest("hex") };
  };
  const before = await sourceIdentity();
  const proof: Record<string, unknown> = {
    kind: "packaged-coding-container-offline-proof",
    startedAt: new Date().toISOString(),
    passed: false,
    source: before,
    containerRemoved: false,
    scope:
      "Current source with image-owned CLI/Bwrap. No login, model inference, host tool bind or API/worker/Postgres installation proof.",
  };
  let attempted = false;
  try {
    const details = JSON.parse(
      (await docker(["info", "--format", "{{json .}}"])).stdout,
    ) as { OSType: string; SecurityOptions?: string[] };
    assert.equal(
      details.OSType,
      "linux",
      "coding_container_requires_linux_engine",
    );
    const apparmor =
      details.SecurityOptions?.some((item) =>
        item.startsWith("name=apparmor"),
      ) ?? false;
    if (process.env.ACOS_CODING_REQUIRE_APPARMOR === "1")
      assert.equal(apparmor, true, "coding_ci_requires_enforced_apparmor");
    const common = codingContainerArguments({
      image,
      fixture,
      profile,
      apparmor,
      name,
    });
    const emptyEnvironment = path.join(directory, "compose.env");
    await writeFile(emptyEnvironment, "", { mode: 0o600 });
    for (const enforce of [false, true]) {
      const files = [
        "compose.yaml",
        "compose.coding.yaml",
        ...(enforce ? ["compose.coding-apparmor.yaml"] : []),
      ];
      const rendered = await run(
        "docker",
        [
          "compose",
          "--project-directory",
          workspace,
          "--env-file",
          emptyEnvironment,
          ...files.flatMap((file) => ["--file", path.join(workspace, file)]),
          "config",
          "--format=json",
        ],
        {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            OPENAI_API_KEY: "",
            OPENROUTER_API_KEY: "",
            AI_INTEGRATIONS_OPENAI_API_KEY: "",
            AI_INTEGRATIONS_OPENAI_BASE_URL: "",
            OLLAMA_BASE_URL: "",
          },
        },
      );
      assertCodingCompose(JSON.parse(rendered.stdout), enforce);
    }
    proof.composeMergeVerified = true;
    // Render the actual installer override last; the manual overlay alone does
    // not prove that reviewed permission/provider settings survive deployment.
    const apiImage = `ghcr.io/fixture/render-only@sha256:${"a".repeat(64)}`;
    const codingImage = `ghcr.io/fixture/render-only@sha256:${"b".repeat(64)}`;
    const settings = planInstallation(
      {
        mode: "container",
        locale: "en",
        port: 5000,
        accessMode: "approval",
        provider: "later",
        phoneAccess: "local",
        toolPacks: [],
        codingRuntime: true,
      },
      {
        platform: "linux",
        architecture: "x64",
        nodeVersion: "v24.20.0",
        postgresClientVersion: null,
        composeVersion: "2.40.0",
        native: { ready: true, issues: [] },
        container: { ready: true, issues: [] },
        coding: { ready: true, issues: [], apparmor },
      },
    );
    const deployment = buildContainerDeployment(
      workspace,
      settings,
      {
        directory,
        secretFiles: {
          database_url: path.join(directory, "database_url"),
          runtime_control_key: path.join(directory, "runtime_control_key"),
          operator_auth_token: path.join(directory, "operator_auth_token"),
          postgres_password: path.join(directory, "postgres_password"),
        },
      },
      {},
      undefined,
      apiImage,
      { image: codingImage, apparmor },
    );
    await writeFile(
      path.join(directory, "compose.override.json"),
      JSON.stringify(deployment.override),
      { mode: 0o600 },
    );
    const rendered = await docker([
      ...deployment.args.slice(0, deployment.args.indexOf("up")),
      "config",
      "--format=json",
    ]);
    const model = JSON.parse(rendered.stdout);
    assertCodingCompose(model, apparmor);
    assert.equal(model.services.app.image, apiImage);
    assert.equal(
      model.services.app.environment.ALLOW_AGENT_CODEX_TASKS,
      "false",
    );
    for (const worker of ["worker-1", "worker-2"]) {
      assert.equal(model.services[worker].image, codingImage);
      assert.equal(
        model.services[worker].environment.ALLOW_AGENT_CODEX_TASKS,
        "true",
      );
      assert.equal(
        model.services[worker].environment.ALLOW_AGENT_PROCESS_EXEC,
        "true",
      );
    }
    proof.installerComposeMergeVerified = true;
    const inspected = JSON.parse(
      (await docker(["image", "inspect", image])).stdout,
    )[0] as {
      Id: string;
      Architecture: string;
      Config: { User: string; Entrypoint: string[]; Env: string[] };
    };
    assert.equal(inspected.Architecture, "amd64", "coding_image_requires_x64");
    assert.equal(
      inspected.Config.User,
      "node",
      "coding_image_requires_nonroot_default",
    );
    assert.deepEqual(
      inspected.Config.Entrypoint,
      ["/usr/bin/tini", "--"],
      "coding_image_requires_pid_one_reaper",
    );
    assert.ok(
      inspected.Config.Env.includes(
        "ACOS_CODEX_EXECUTABLE=/opt/agentic-codex/bin/codex",
      ),
    );
    proof.imageId = inspected.Id;
    proof.apparmor = apparmor
      ? "agentic-coding (enforce required)"
      : "engine has no AppArmor";
    proof.profileSha256 = createHash("sha256")
      .update(await readFile(profile))
      .digest("hex");
    const esbuild = createRequire(
      path.join(workspace, "artifacts/api-server/package.json"),
    )("esbuild") as {
      build: (options: Record<string, unknown>) => Promise<unknown>;
    };
    const bundles: Record<string, string> = {};
    for (const [entry, name] of ENTRIES) {
      const outfile = path.join(fixture, name);
      await esbuild.build({
        entryPoints: [
          path.join(workspace, "artifacts/api-server/src/lib", entry),
        ],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        logLevel: "warning",
      });
      await chmod(outfile, 0o644);
      bundles[name] = createHash("sha256")
        .update(await readFile(outfile))
        .digest("hex");
    }
    proof.bundles = bundles;
    attempted = true;
    const identity = JSON.parse(
      (
        await docker([
          ...common,
          inspected.Id,
          "node",
          "-e",
          "const fs=require('fs'),crypto=require('crypto');console.log(JSON.stringify({uid:process.getuid(),node:process.version,bwrapSha256:crypto.createHash('sha256').update(fs.readFileSync('/usr/bin/bwrap')).digest('hex'),innerBwrapSha256:crypto.createHash('sha256').update(fs.readFileSync('/opt/agentic-inner/bwrap')).digest('hex'),manifest:JSON.parse(fs.readFileSync('/opt/agentic-codex/fixture-owner.json','utf8')),apparmor:fs.existsSync('/proc/self/attr/current')?fs.readFileSync('/proc/self/attr/current','utf8').trim():null}));",
        ])
      ).stdout,
    );
    assertCodingContainerIdentity(identity);
    if (apparmor)
      assert.equal(
        identity.apparmor,
        "agentic-coding (enforce)",
        "coding_apparmor_must_be_enforced",
      );
    proof.identity = identity;
    let result: { stdout: string; stderr: string };
    try {
      result = await docker(
        [
          ...common,
          inspected.Id,
          "node",
          "--no-wasm-code-gc",
          "--test",
          "--test-reporter=tap",
          "--test-concurrency=1",
          ...ENTRIES.filter(([, name]) => name.endsWith(".test.mjs")).map(
            ([, name]) => `/fixture/${name}`,
          ),
        ],
        120_000,
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      await writeFile(
        path.join(directory, "native-tests.log"),
        (failure.stdout ?? "") + (failure.stderr ?? ""),
        { mode: 0o600 },
      );
      throw error;
    }
    await writeFile(
      path.join(directory, "native-tests.log"),
      result.stdout + result.stderr,
      { mode: 0o600 },
    );
    assertNativeTestSummary(0, result.stdout);
    assert.deepEqual(
      await sourceIdentity(),
      before,
      "coding_container_source_changed_during_test",
    );
    proof.sourceStable = true;
    proof.tests = 23;
    proof.passed = true;
  } finally {
    if (attempted) {
      try {
        await docker(["rm", "--force", name]);
      } catch {
        /* --rm normally already removed it; verify below. */
      }
      try {
        await docker(["container", "inspect", name]);
      } catch (error) {
        if (isMissingOwnedContainer(error, name)) proof.containerRemoved = true;
      }
    }
    proof.completedAt = new Date().toISOString();
    if (proof.passed && proof.containerRemoved !== true) proof.passed = false;
    await writeFile(
      path.join(directory, "evidence.json"),
      JSON.stringify(proof, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        passed: proof.passed,
        evidence: path.join(directory, "evidence.json"),
        imageId: proof.imageId,
      }),
    );
  }
  assert.equal(proof.passed, true, "coding_container_gate_failed");
  return { directory, proof };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await runCodingContainerSmoke(process.argv[2] ?? "");
