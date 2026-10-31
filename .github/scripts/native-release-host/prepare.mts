import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  realpath,
  open,
  statfs,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReleaseConfiguration,
  assertExternalWorkflowContext,
  assertSourceIdentity,
  assertNativeMainProducer,
} from "./guard.mjs";
import { verifyDriverCopy } from "./copy.mjs";
import {
  derivePrivatePackageDriver,
  deriveControlledBaselineDriver,
} from "./derive.mjs";
import { deriveOrdinaryWindowsWrapper } from "./windows-wrapper.mjs";
import { sha256ExactFile } from "../../scripts/src/endurance/native-runtime-provenance";
import { verifyCheckoutLog } from "../../scripts/src/release/checkout";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
let stage = "configuration",
  lastHttpStatus: number | null = null,
  owned: string | undefined;
const inputDeadline = Date.now() + 30 * 60000;
const remaining = (cap: number) => {
  const time = inputDeadline - Date.now();
  assert.ok(time > 0, "release_input_deadline");
  return Math.max(1, Math.min(time, cap));
};
const save = async (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const git = async (root: string, ...args: string[]) =>
  (
    await execute("git", ["-C", root, ...args], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1048576,
    })
  ).stdout.trim();
async function boundedBody(response: Response, limit: number) {
  assert.ok(response.body, "response_body_required");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += value.length;
    assert.ok(total <= limit, "bounded_metadata_required");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
async function main() {
  // Unresolved release inputs fail before token access, downloads or fixture creation.
  const config = assertReleaseConfiguration(
    JSON.parse(await readFile(path.join(directory, "config.json"), "utf8")),
  );
  stage = "source_identity";
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v24.22.1");
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "disposable_hosted_workflow_required",
  );
  const externalWorkflow = assertExternalWorkflowContext({
    eventName: process.env.GITHUB_EVENT_NAME,
    runId: Number(process.env.GITHUB_RUN_ID),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    ref: process.env.GITHUB_REF,
  });
  assert.equal(process.env.GITHUB_REPOSITORY, config.repo);
  assert.equal(process.env.GITHUB_REPOSITORY_ID, String(config.repositoryId));
  const app = await realpath(process.env.ACOS_APPLICATION_ROOT!);
  const driver = await realpath(process.env.ACOS_DRIVER_ROOT!);
  assert.notEqual(
    app,
    driver,
    "separate_application_and_driver_checkout_required",
  );
  const driverTree = await git(driver, "rev-parse", "HEAD^{tree}");
  const identity = {
    applicationCommit: config.applicationCommit,
    applicationTree: config.applicationTree,
    driverCommit: process.env.GITHUB_SHA,
    driverTree,
  };
  const observed = {
    applicationCommit: await git(app, "rev-parse", "HEAD"),
    applicationTree: await git(app, "rev-parse", "HEAD^{tree}"),
    driverCommit: await git(driver, "rev-parse", "HEAD"),
    driverTree: await git(driver, "rev-parse", "HEAD^{tree}"),
    applicationClean:
      (await git(
        app,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      )) === "",
    driverClean:
      (await git(
        driver,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      )) === "",
  };
  assertSourceIdentity(identity, observed);
  assert.equal(
    await git(driver, "status", "--porcelain=v1", "--untracked-files=normal"),
    "",
    "clean_external_driver_checkout_required",
  );
  assert.equal(
    await realpath(directory),
    path.join(app, ".tmp", "native-release-host"),
    "expected_copied_driver_location_required",
  );
  const trackedDriverDirectory = path.join(
    driver,
    ".github",
    "scripts",
    "native-release-host",
  );
  const copiedDriver = await verifyDriverCopy(
    trackedDriverDirectory,
    directory,
  );
  const token = process.env.GH_TOKEN;
  assert.ok(token, "workflow_read_token_required");
  const prefix = "repos/" + config.repo + "/";
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AgenticOS-native-release-proof",
  };
  async function api(route: string) {
    assert.ok(route.startsWith(prefix), "same_repository_read_required");
    let response: Response;
    try {
      response = await fetch("https://api.github.com/" + route, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(remaining(30000)),
      });
    } catch {
      throw new Error("github_metadata_transport_failed");
    }
    lastHttpStatus = response.status;
    assert.equal(response.status, 200, "github_metadata_read_failed");
    return JSON.parse(
      (await boundedBody(response, 16 * 1024 * 1024)).toString(),
    );
  }
  async function arrayPages(route: string, key: string) {
    const all: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const value = await api(
        route + (route.includes("?") ? "&" : "?") + "per_page=100&page=" + page,
      );
      const rows = value[key];
      assert.ok(Array.isArray(rows) && rows.length <= 100);
      all.push(...rows);
      if (rows.length < 100) {
        assert.equal(
          all.length,
          value.total_count,
          "complete_input_pagination_required",
        );
        return all;
      }
    }
    throw new Error("input_pagination_did_not_finish");
  }
  stage = "original_native_producer";
  const [mainCommit, run, jobs, artifacts] = await Promise.all([
    api(prefix + "commits/main"),
    api(prefix + "actions/runs/" + config.nativeRunId),
    arrayPages(
      prefix + "actions/runs/" + config.nativeRunId + "/attempts/1/jobs",
      "jobs",
    ),
    arrayPages(
      prefix + "actions/runs/" + config.nativeRunId + "/artifacts",
      "artifacts",
    ),
  ]);
  assert.equal(
    mainCommit.sha,
    config.applicationCommit,
    "current_main_source_required",
  );
  assert.equal(mainCommit.commit.tree.sha, config.applicationTree);
  const producer = assertNativeMainProducer(run, config);
  const expectedNames = [
    "Native package win32-x64",
    "Native package darwin-arm64",
    "Native package darwin-x64",
    "Native package linux-x64",
    "Native package linux-arm64",
  ];
  assert.deepEqual(jobs.map((j) => j.name).sort(), expectedNames.sort());
  for (const job of jobs) {
    assert.equal(job.status, "completed");
    assert.equal(job.conclusion, "success");
  }
  const windows = jobs.find((j) => j.name === "Native package win32-x64");
  assert.ok(windows && Number.isSafeInteger(windows.id) && windows.id > 0);
  const matches = artifacts.filter(
    (a) =>
      a.id === config.nativeArtifactId &&
      a.name === "Agentic-Company-OS-win32-x64",
  );
  assert.equal(matches.length, 1);
  const artifact = matches[0];
  assert.equal(artifact.expired, false);
  assert.equal(artifact.size_in_bytes, config.nativeArtifactBytes);
  assert.equal(artifact.digest, "sha256:" + config.nativeArtifactDigest);
  assert.equal(artifact.workflow_run.id, config.nativeRunId);
  assert.equal(artifact.workflow_run.head_sha, config.applicationCommit);
  assert.equal(artifact.workflow_run.head_branch, "main");
  assert.equal(artifact.workflow_run.repository_id, config.repositoryId);
  assert.equal(artifact.workflow_run.head_repository_id, config.repositoryId);
  const checkRows = await arrayPages(
    prefix + "commits/" + config.applicationCommit + "/check-runs?filter=all",
    "check_runs",
  );
  assert.equal(
    checkRows.filter(
      (c) =>
        c.status === "completed" &&
        [
          "failure",
          "timed_out",
          "cancelled",
          "action_required",
          "startup_failure",
        ].includes(c.conclusion),
    ).length,
    0,
    "current_main_has_failed_checks",
  );
  const pendingMainChecks = checkRows.filter(
    (c) => c.status !== "completed",
  ).length;
  // Pending original main checks remain pending release gates, never accepted here.
  stage = "owned_input_root";
  const parent = await realpath(process.env.RUNNER_TEMP!);
  assert.ok(
    (await statfs(parent)).bavail * (await statfs(parent)).bsize >=
      8 * 1024 ** 3,
    "original_owned_fixture_disk_margin_required",
  );
  assert.ok(
    (await statfs("C:/")).bavail * (await statfs("C:/")).bsize >= 2 * 1024 ** 3,
    "original_c_disk_margin_required",
  );
  owned = await mkdtemp(path.join(parent, "acos-native-release-host-"));
  await writeFile(
    path.join(owned, ".owned-native-release-host"),
    "Private synthetic native release proof\n",
    { flag: "wx", mode: 0o600 },
  );
  const checkpoint = async () =>
    save(path.join(owned!, "input-stage-" + stage + ".json"), {
      stage,
      lastHttpStatus,
      applicationCommit: config.applicationCommit,
      driverCommit: identity.driverCommit,
    });
  async function redirectedBytes(route: string) {
    let response: Response;
    try {
      response = await fetch("https://api.github.com/" + route, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(remaining(30000)),
      });
    } catch {
      throw new Error("github_redirect_transport_failed");
    }
    lastHttpStatus = response.status;
    assert.equal(response.status, 302, "github_download_redirect_required");
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.protocol, "https:");
    assert.equal(location.username, "");
    assert.equal(location.password, "");
    assert.equal(location.hash, "");
    // Temporary signed location is used only in memory. Never forward GitHub auth.
    try {
      const value = await fetch(location, {
        redirect: "error",
        signal: AbortSignal.timeout(remaining(15 * 60000)),
      });
      lastHttpStatus = value.status;
      assert.equal(value.status, 200, "github_binary_read_failed");
      return value;
    } catch {
      throw new Error("github_binary_transport_failed");
    }
  }
  stage = "native_checkout_log";
  const checkoutResponse = await redirectedBytes(
    prefix + "actions/jobs/" + windows.id + "/logs",
  );
  const checkoutBytes = await boundedBody(checkoutResponse, 128 * 1024 * 1024);
  const checkout = verifyCheckoutLog(
    checkoutBytes.toString(),
    windows,
    "Check out exact workflow revision",
    { ref: "refs/remotes/origin/main", sha: config.applicationCommit },
  );
  await writeFile(
    path.join(owned, "private-native-original.log"),
    checkoutBytes,
    { flag: "wx", mode: 0o600 },
  );
  await checkpoint();
  async function download(
    response: Response,
    file: string,
    bytes: number,
    digest: string,
  ) {
    assert.ok(response.body);
    assert.ok(Number.isSafeInteger(bytes) && bytes > 0);
    const destination = await open(file, "wx", 0o600);
    let total = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        assert.ok(total <= bytes, "download_size_limit");
        await destination.writeFile(chunk);
      }
    } finally {
      await destination.close();
    }
    assert.equal(total, bytes, "download_exact_size_required");
    assert.equal(
      await sha256ExactFile(file, "Owned pinned release input"),
      digest,
      "download_digest_mismatch",
    );
  }
  async function publicDownload(
    url: string,
    file: string,
    bytes: number,
    digest: string,
  ) {
    assert.ok(
      url.startsWith("https://github.com/"),
      "pinned_public_release_url_required",
    );
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(remaining(15 * 60000)),
      });
    } catch {
      throw new Error("public_input_transport_failed");
    }
    lastHttpStatus = response.status;
    assert.equal(response.status, 200, "public_input_read_failed");
    assert.equal(new URL(response.url).protocol, "https:");
    await download(response, file, bytes, digest);
  }
  const python = process.env.PYTHON;
  assert.ok(python && path.isAbsolute(python), "absolute_host_python_required");
  const prepare = async (action: string, args: string[]) => {
    const result = await execute(
      python,
      [
        path.join(directory, "archive_inputs.py"),
        action,
        "--owned-root",
        owned!,
        ...args,
      ],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: remaining(5 * 60000),
        maxBuffer: 1048576,
      },
    );
    const value = JSON.parse(result.stdout);
    assert.equal(value.accepted, true);
    assert.equal(value.executedCode, false);
    return value;
  };
  stage = "download_native_artifact";
  const envelope = path.join(owned, "original-native-artifact.zip");
  await download(
    await redirectedBytes(
      prefix + "actions/artifacts/" + config.nativeArtifactId + "/zip",
    ),
    envelope,
    config.nativeArtifactBytes,
    config.nativeArtifactDigest,
  );
  await checkpoint();
  stage = "inspect_native_artifact";
  await prepare("native", [
    "--archive",
    envelope,
    "--application-commit",
    config.applicationCommit,
    "--artifact-sha",
    config.nativeArtifactDigest,
    "--artifact-bytes",
    String(config.nativeArtifactBytes),
  ]);
  await checkpoint();
  stage = "published_baseline_metadata";
  const release = await api(prefix + "releases/tags/v0.5.7");
  assert.equal(release.id, 421370510);
  assert.equal(release.tag_name, "v0.5.7");
  assert.equal(
    release.target_commitish,
    "ea9c571be0f81f4590453086e6675ff654ab1458",
  );
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  assert.ok(release.published_at);
  const baselineAssets = [
    {
      name: "Agentic-Company-OS-win32-x64.zip",
      bytes: 76115232,
      sha256:
        "6d8f6ab631f527d5cfc1e7c63c5584e3e6b4f89d7c38dc900cd291378193c80a",
    },
    {
      name: "Agentic-Company-OS-win32-x64.provenance.json",
      bytes: 1002,
      sha256:
        "89d013141e724c9b11055c92e78a5d883f3c1bee8584911dcca26cf442cbb36c",
    },
  ];
  for (const expected of baselineAssets) {
    const rows = release.assets.filter((a: any) => a.name === expected.name);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].size, expected.bytes);
    assert.equal(rows[0].digest, "sha256:" + expected.sha256);
    assert.equal(
      rows[0].browser_download_url,
      "https://github.com/" +
        config.repo +
        "/releases/download/v0.5.7/" +
        expected.name,
    );
  }
  await checkpoint();
  stage = "download_published_baseline";
  for (const asset of baselineAssets)
    await publicDownload(
      "https://github.com/" +
        config.repo +
        "/releases/download/v0.5.7/" +
        asset.name,
      path.join(owned, "baseline-" + asset.name),
      asset.bytes,
      asset.sha256,
    );
  await checkpoint();
  stage = "inspect_published_baseline";
  await prepare("baseline", [
    "--archive",
    path.join(owned, "baseline-" + baselineAssets[0]!.name),
    "--provenance",
    path.join(owned, "baseline-" + baselineAssets[1]!.name),
  ]);
  await checkpoint();
  stage = "download_ollama";
  const runtimeArchive = path.join(owned, "ollama-0.40.3.zip");
  await publicDownload(
    "https://github.com/ollama/ollama/releases/download/v0.40.3/ollama-windows-amd64.zip",
    runtimeArchive,
    1468053171,
    "e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5",
  );
  await checkpoint();
  stage = "inspect_ollama";
  await prepare("ollama", ["--archive", runtimeArchive]);
  await checkpoint();
  assertSourceIdentity(identity, {
    applicationCommit: await git(app, "rev-parse", "HEAD"),
    applicationTree: await git(app, "rev-parse", "HEAD^{tree}"),
    applicationClean:
      (await git(
        app,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      )) === "",
    driverCommit: await git(driver, "rev-parse", "HEAD"),
    driverTree: await git(driver, "rev-parse", "HEAD^{tree}"),
    driverClean:
      (await git(
        driver,
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      )) === "",
  });
  assert.deepEqual(
    await verifyDriverCopy(trackedDriverDirectory, directory),
    copiedDriver,
    "copied_driver_changed_during_preparation",
  );
  const freshMain = await api(prefix + "commits/main");
  assert.equal(
    freshMain.sha,
    config.applicationCommit,
    "main_advanced_during_input_preparation",
  );
  stage = "derive_ordinary_test_drivers";
  const freshDriver = derivePrivatePackageDriver(
    await readFile(
      path.join(app, "scripts/src/setup/native-package-smoke.ts"),
      "utf8",
    ),
  );
  const baselineDriver = deriveControlledBaselineDriver(
    await readFile(
      path.join(app, "scripts/src/setup/native-package-smoke.ts"),
      "utf8",
    ),
  );
  const ordinaryWrapper = deriveOrdinaryWindowsWrapper(
    await readFile(
      path.join(app, "scripts/test-native-package-windows.ps1"),
      "utf8",
    ),
  );
  await writeFile(
    path.join(directory, "fresh-package-driver.mts"),
    freshDriver.source,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    path.join(directory, "baseline-package-driver.mts"),
    baselineDriver.source,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    path.join(directory, "ordinary-native-host.ps1"),
    ordinaryWrapper.source,
    { flag: "wx", mode: 0o600 },
  );
  const publicOutputRoot = path.join(parent, "native-release-host-public");
  await mkdir(publicOutputRoot);
  remaining(1);
  const context = {
    schema: "native-release-host-private-inputs@1",
    accepted: true,
    config,
    identity,
    driverTree,
    externalWorkflow,
    applicationRoot: app,
    driverRoot: driver,
    ownedRoot: owned,
    publicOutputRoot,
    copiedDriver,
    derivedTestDrivers: {
      fresh: {
        inputSha256: freshDriver.inputSha256,
        outputSha256: freshDriver.outputSha256,
        changes: freshDriver.changes,
      },
      baseline: {
        inputSha256: baselineDriver.inputSha256,
        outputSha256: baselineDriver.outputSha256,
        changes: baselineDriver.changes,
      },
      ordinaryWindows: {
        inputSha256: ordinaryWrapper.inputSha256,
        outputSha256: ordinaryWrapper.outputSha256,
        changes: ordinaryWrapper.changes,
      },
    },
    nativeProducer: {
      ...producer,
      jobId: windows.id,
      checkout,
      artifactId: artifact.id,
      artifactDigest: artifact.digest,
    },
    pendingMainChecksAtInputAdmission: pendingMainChecks,
    originalMainChecksStillSeparateReleaseGates: true,
    executedApplicationOrModelCode: false,
  };
  await save(path.join(owned, "context.json"), context);
  await writeFile(
    path.join(directory, "private-context-path.txt"),
    path.join(owned, "context.json") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      accepted: true,
      stage: "inputs_ready",
      applicationCommit: config.applicationCommit,
      driverCommit: identity.driverCommit,
      nativeRunId: config.nativeRunId,
      applicationOrModelStarted: false,
      pendingMainChecks,
    }),
  );
}
try {
  await main();
} catch {
  const failure = {
    accepted: false,
    stage,
    lastHttpStatus,
    failureCode: "release_input_preparation_failed",
    applicationOrModelStarted: false,
  };
  if (owned)
    await save(path.join(owned, "input-failure.json"), failure).catch(() => {});
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
}
