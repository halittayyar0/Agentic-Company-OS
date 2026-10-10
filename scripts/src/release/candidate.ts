import assert from "node:assert/strict";
import {
  record,
  verifyScopedCodeScanning,
  type GitHubReadApi,
} from "./github-security";

export const requiredReleaseChecks = [
  "Format, audit, test, typecheck, and build",
  "Windows runtime and process-tree regression",
  "Build and exercise production and endurance containers",
  "JavaScript and TypeScript analysis",
  "Gitleaks history scan",
  "Native macOS Apple Silicon",
  "Native macOS Intel",
  "Packaged Codex container permission and lifetime proof",
  "Linux owned PID namespace lifetime",
  "Coding helper known-live privacy and namespace regression",
]
  .map((context) => ({ context, app_id: 15368 }))
  .concat([{ context: "CodeQL", app_id: 57789 }]);

export interface CandidateExpectation {
  phase: "pr" | "main";
  pr: number;
  head: string;
  base: string;
  tree: string;
  testedMerge: string;
}
export function verifyStableCandidateSnapshot(
  before: Awaited<ReturnType<typeof verifyGitHubCandidate>>,
  after: Awaited<ReturnType<typeof verifyGitHubCandidate>>,
) {
  const identity = (value: typeof before) => ({
    phase: value.phase,
    pr: value.pr,
    head: value.head,
    base: value.base,
    tree: value.tree,
    testedMerge: value.testedMerge,
    main: value.main,
    repository: value.repository,
    headRepository: value.headRepository,
    gates: value.gates
      .map((gate) => [gate.sha, gate.name, gate.appId, gate.id])
      .sort(),
  });
  assert.deepEqual(
    identity(after),
    identity(before),
    "Candidate or check identities changed while logs were verified",
  );
}
function verifyPolicy(value: unknown) {
  const protection = record(value);
  const policy = record(protection.required_status_checks);
  assert.equal(policy.strict, true, "Strict branch protection is required");
  assert.equal(
    record(protection.required_linear_history).enabled,
    true,
    "Linear history is required",
  );
  assert.ok(Array.isArray(policy.checks), "Missing required checks");
  const normalized = policy.checks
    .map((value) => {
      const check = record(value);
      return [check.context, check.app_id];
    })
    .sort();
  assert.deepEqual(
    normalized,
    requiredReleaseChecks.map((check) => [check.context, check.app_id]).sort(),
    "Required context/App policy changed",
  );
}
async function readChecks(api: GitHubReadApi, sha: string) {
  const checks: Record<string, unknown>[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const response = record(
      await api(
        `commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`,
      ),
    );
    assert.ok(
      Number.isSafeInteger(response.total_count) &&
        Number(response.total_count) >= 0,
      "Missing check-run total",
    );
    if (total === undefined) total = Number(response.total_count);
    assert.equal(
      response.total_count,
      total,
      "Check-run set changed during pagination",
    );
    assert.ok(
      Array.isArray(response.check_runs) && response.check_runs.length <= 100,
      "Invalid check-run page",
    );
    checks.push(...response.check_runs.map(record));
    if (response.check_runs.length < 100) {
      assert.equal(checks.length, total, "Incomplete check-run pagination");
      assert.equal(
        new Set(checks.map((check) => check.id)).size,
        checks.length,
        "Repeated check-run page",
      );
      return checks;
    }
  }
  throw new Error("Check-run pagination did not finish");
}
async function verifyChecks(
  api: GitHubReadApi,
  sha: string,
  includeCodeQL: boolean,
) {
  const checks = await readChecks(api, sha);
  return requiredReleaseChecks
    .filter((check) => includeCodeQL || check.app_id !== 57789)
    .map((expected) => {
      const matches = checks.filter((check) => check.name === expected.context);
      assert.equal(
        matches.length,
        1,
        `Missing or ambiguous required check: ${expected.context}`,
      );
      const check = matches[0]!;
      assert.equal(
        record(check.app).id,
        expected.app_id,
        `Wrong App for ${expected.context}`,
      );
      assert.equal(
        check.head_sha,
        sha,
        "Required check belongs to another commit",
      );
      assert.equal(
        check.status,
        "completed",
        `Required check is pending: ${expected.context}`,
      );
      assert.equal(
        check.conclusion,
        "success",
        `Required check did not succeed: ${expected.context}`,
      );
      assert.ok(
        Number.isSafeInteger(check.id) && Number(check.id) > 0,
        "Invalid check-run ID",
      );
      return {
        sha,
        name: expected.context,
        appId: expected.app_id,
        id: Number(check.id),
      };
    });
}
export async function verifyGitHubCandidate(
  api: GitHubReadApi,
  expected: CandidateExpectation,
) {
  assert.ok(
    expected.phase === "pr" || expected.phase === "main",
    "Unknown verification phase",
  );
  assert.ok(
    Number.isSafeInteger(expected.pr) && expected.pr > 0,
    "Exact PR number is required",
  );
  for (const sha of [
    expected.head,
    expected.base,
    expected.tree,
    expected.testedMerge,
  ])
    assert.match(sha, /^[a-f0-9]{40}$/u, "Exact SHA is required");
  const pr = record(await api(`pulls/${expected.pr}`));
  const main = record(await api("commits/main"));
  const candidate = record(await api(`commits/${expected.head}`));
  const testedMerge = record(await api(`commits/${expected.testedMerge}`));
  assert.equal(pr.number, expected.pr);
  assert.equal(record(pr.head).sha, expected.head, "PR head changed");
  assert.equal(record(pr.base).sha, expected.base, "PR base changed");
  assert.equal(record(pr.base).ref, "main", "PR does not target main");
  assert.equal(pr.draft, false, "Draft PR is not eligible for acceptance");
  const repository = record(record(pr.base).repo).full_name;
  const headRepository = record(record(pr.head).repo).full_name;
  assert.equal(typeof repository, "string");
  assert.equal(typeof headRepository, "string");
  for (const name of [repository, headRepository])
    assert.match(String(name), /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/u);
  assert.equal(candidate.sha, expected.head);
  assert.equal(
    record(record(candidate.commit).tree).sha,
    expected.tree,
    "Candidate tree changed",
  );
  assert.equal(testedMerge.sha, expected.testedMerge);
  assert.equal(
    record(record(testedMerge.commit).tree).sha,
    expected.tree,
    "Tested merge tree changed",
  );
  assert.ok(Array.isArray(testedMerge.parents));
  assert.deepEqual(
    testedMerge.parents.map((parent) => record(parent).sha),
    [expected.base, expected.head],
    "Tested merge parents changed",
  );
  if (expected.phase === "pr") {
    assert.equal(pr.state, "open");
    assert.equal(pr.merged, false);
    assert.equal(
      pr.merge_commit_sha,
      expected.testedMerge,
      "PR tested merge changed",
    );
    assert.equal(
      main.sha,
      expected.base,
      "Main moved after candidate preparation",
    );
  } else {
    assert.equal(pr.state, "closed");
    assert.equal(pr.merged, true, "PR has not merged");
    assert.equal(
      pr.merge_commit_sha,
      main.sha,
      "Main is not the accepted PR squash",
    );
    assert.equal(
      record(record(main.commit).tree).sha,
      expected.tree,
      "Squash tree differs from the tested candidate",
    );
    assert.ok(Array.isArray(main.parents));
    assert.deepEqual(
      main.parents.map((parent) => record(parent).sha),
      [expected.base],
      "Main is not the expected ordinary squash",
    );
  }
  assert.equal(typeof main.sha, "string");
  const mainSha = String(main.sha);
  assert.match(mainSha, /^[a-f0-9]{40}$/u);
  verifyPolicy(await api("branches/main/protection"));
  const gates = await verifyChecks(api, expected.head, true);
  if (expected.phase === "main")
    gates.push(...(await verifyChecks(api, mainSha, false)));
  const security = await verifyScopedCodeScanning(api, [
    { ref: "refs/heads/main", sha: mainSha },
    { ref: `refs/pull/${expected.pr}/merge`, sha: expected.testedMerge },
  ]);
  // A passing snapshot must not survive a moved head, base, merge or policy
  // while the paginated checks and security queries were in flight.
  const freshPr = record(await api(`pulls/${expected.pr}`));
  for (const field of [
    "number",
    "state",
    "merged",
    "draft",
    "merge_commit_sha",
  ] as const)
    assert.equal(freshPr[field], pr[field], "PR changed during verification");
  assert.equal(
    record(freshPr.head).sha,
    expected.head,
    "PR head changed during verification",
  );
  assert.equal(
    record(freshPr.base).sha,
    expected.base,
    "PR base changed during verification",
  );
  assert.equal(record(freshPr.base).ref, "main");
  assert.equal(
    record(record(freshPr.base).repo).full_name,
    repository,
    "Repository changed during verification",
  );
  assert.equal(
    record(record(freshPr.head).repo).full_name,
    headRepository,
    "Head repository changed during verification",
  );
  assert.equal(
    record(await api("commits/main")).sha,
    mainSha,
    "Main changed during verification",
  );
  verifyPolicy(await api("branches/main/protection"));
  return {
    schema: "agentic-company-os/release-checks@1",
    recordedAt: new Date().toISOString(),
    ...expected,
    main: mainSha,
    repository: String(repository),
    headRepository: String(headRepository),
    checksAndSecurityPassed: true,
    publicationReady: false,
    gates,
    security,
    scope:
      "Exact candidate/tree/merge/strict context-App checks and scoped CodeQL only. Complete source/UI logs, platform artifacts, installation, distribution and public readback require separate acceptance. Not live-account, physical-phone or 24-hour proof.",
  };
}
