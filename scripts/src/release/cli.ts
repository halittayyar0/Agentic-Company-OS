import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  verifyGitHubCandidate,
  verifyStableCandidateSnapshot,
  type CandidateExpectation,
} from "./candidate";
import { record, type GitHubReadApi } from "./github-security";
import { verifyCandidateSuites } from "./suites";

const execute = promisify(execFile);
export interface ReleaseArguments {
  repo: string;
  output: string;
  gh: string;
  candidate: CandidateExpectation;
}
export function parseReleaseArguments(
  args: readonly string[],
): ReleaseArguments {
  const allowed = new Set([
    "repo",
    "phase",
    "pr",
    "head",
    "base",
    "tree",
    "tested-merge",
    "output",
    "gh",
  ]);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/u, "");
    assert.ok(
      args[i]?.startsWith("--") && key && allowed.has(key),
      "Unknown release argument",
    );
    assert.ok(!values.has(key), `Duplicate argument: --${key}`);
    const value = args[i + 1];
    assert.ok(value && !value.startsWith("--"), `Missing value: --${key}`);
    values.set(key, value);
  }
  const required = (key: string) => {
    const value = values.get(key);
    assert.ok(value, `Required argument: --${key}`);
    return value;
  };
  const repo = required("repo");
  assert.match(
    repo,
    /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/u,
    "Repository must be owner/name",
  );
  assert.ok(![".", ".."].includes(repo.split("/")[1]!));
  const phase = required("phase");
  assert.ok(phase === "pr" || phase === "main", "Phase must be pr or main");
  const pr = required("pr");
  assert.match(pr, /^[1-9]\d*$/u, "PR must be an integer");
  assert.ok(Number.isSafeInteger(Number(pr)));
  const exactSha = (key: string) => {
    const value = required(key);
    assert.match(value, /^[a-f0-9]{40}$/u, `Exact SHA required: --${key}`);
    return value;
  };
  return {
    repo,
    gh: values.get("gh") ?? "gh",
    output: path.resolve(required("output")),
    candidate: {
      phase,
      pr: Number(pr),
      head: exactSha("head"),
      base: exactSha("base"),
      tree: exactSha("tree"),
      testedMerge: exactSha("tested-merge"),
    },
  };
}
export async function writeReleaseReport(
  file: string,
  report: unknown,
): Promise<void> {
  await writeFile(file, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
async function run(options: ReleaseArguments) {
  try {
    await access(options.output);
    throw new Error(
      "Output already exists; preserve previous evidence and choose a new path",
    );
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  const read = async (endpoint: string) => {
    assert.ok(
      /^(?:pulls\/\d+|commits\/(?:main|[a-f0-9]{40})(?:\/check-runs\?.+)?|branches\/main\/protection|code-scanning\/(?:analyses|alerts)\?.+|actions\/(?:jobs\/\d+(?:\/logs)?|runs\/\d+(?:\/jobs\?.+)?)|contents\/scripts\/release-expectations\.json\?ref=[a-f0-9]{40})$/u.test(
        endpoint,
      ),
      "Unsupported read endpoint",
    );
    try {
      const result = await execute(
        options.gh,
        [
          "api",
          "--method",
          "GET",
          "--hostname",
          "github.com",
          "--allow-escape-sequences",
          `repos/${options.repo}/${endpoint}`,
        ],
        {
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 128 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        },
      );
      return result.stdout;
    } catch {
      throw new Error(
        `GitHub read failed: ${endpoint.split("?")[0]}. Check CLI authentication, read permissions and network; no passing report was written.`,
      );
    }
  };
  const api: GitHubReadApi = async (endpoint) =>
    JSON.parse(await read(endpoint));
  const before = await verifyGitHubCandidate(api, options.candidate);
  assert.equal(
    before.repository,
    options.repo,
    "Candidate belongs to another repository",
  );
  // Read expectations from the exact immutable candidate, never from a dirty
  // working directory or a mutable default-branch response.
  const file = record(
    await api(
      `contents/scripts/release-expectations.json?ref=${options.candidate.head}`,
    ),
  );
  assert.equal(file.type, "file");
  assert.equal(file.path, "scripts/release-expectations.json");
  assert.equal(file.encoding, "base64");
  assert.equal(typeof file.content, "string");
  const bytes = Buffer.from(String(file.content), "base64");
  assert.ok(bytes.length > 0 && bytes.length < 1024 * 1024);
  assert.equal(file.size, bytes.length);
  const blobSha = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  assert.equal(file.sha, blobSha, "Candidate expectations blob mismatch");
  const suites = await verifyCandidateSuites(
    api,
    (id) => read(`actions/jobs/${id}/logs`),
    before,
    JSON.parse(bytes.toString("utf8")),
  );
  const after = await verifyGitHubCandidate(api, options.candidate);
  verifyStableCandidateSnapshot(before, after);
  const report = {
    ...after,
    schema: "agentic-company-os/release-verification@1",
    repo: options.repo,
    sourceAndUiLogsPassed: true,
    expectationsBlobSha: blobSha,
    suites,
    publicationReady: false,
    scope:
      "Original required context/App checks and every Actions producer workflow/checkout, exact candidate/merge/squash identity, both scoped CodeQL analyses and all-tools open-alert queries, complete original Linux/Windows/two Mac source plus clean Linux/two Mac UI logs, stable check IDs before/after. Native evidence bundles, independent endurance/coding verifiers, distribution images/install/backup/ZIP and anonymous public readback remain separate required acceptance. No human-account inference, physical-phone or 24-hour claim.",
  };
  await writeReleaseReport(options.output, report);
  console.log(
    JSON.stringify({
      checksAndSecurityPassed: true,
      sourceAndUiLogsPassed: true,
      publicationReady: false,
      phase: report.phase,
      head: report.head,
      main: report.main,
      sourceStages: 4,
      uiStages: 3,
      output: options.output,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") {
    console.log(
      "pnpm release:verify --repo OWNER/NAME --phase pr|main --pr NUMBER --head SHA --base SHA --tree SHA --tested-merge SHA --output NEW_REPORT.json [--gh /path/to/gh]\nRead-only GitHub checks, scoped security and original platform source/UI logs. Requires Node 24, pinned pnpm and authenticated GitHub CLI with repository, Actions and code-scanning read access. Does not publish or replace installation/artifact acceptance.",
    );
  } else {
    try {
      await run(parseReleaseArguments(process.argv.slice(2)));
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Release verification failed",
      );
      process.exitCode = 1;
    }
  }
}
