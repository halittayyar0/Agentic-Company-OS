import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verifyGitHubCandidate,
  verifyStableCandidateSnapshot,
  requiredReleaseChecks,
  type CandidateExpectation,
} from "./candidate";
import type { GitHubReadApi } from "./github-security";

const head = "a".repeat(40),
  base = "b".repeat(40),
  tree = "c".repeat(40),
  merge = "d".repeat(40),
  main = "e".repeat(40);
const expected: CandidateExpectation = {
  phase: "pr",
  pr: 47,
  head,
  base,
  tree,
  testedMerge: merge,
};
function fixture(phase: "pr" | "main" = "pr") {
  const pr = {
    number: 47,
    state: phase === "pr" ? "open" : "closed",
    merged: phase === "main",
    draft: false,
    head: { sha: head, repo: { full_name: "fixture/repo" } },
    base: { sha: base, ref: "main", repo: { full_name: "fixture/repo" } },
    merge_commit_sha: phase === "pr" ? merge : main,
  };
  const policy = {
    required_status_checks: {
      strict: true,
      checks: structuredClone(requiredReleaseChecks),
    },
    required_linear_history: { enabled: true },
  };
  const checks = (sha: string) =>
    requiredReleaseChecks
      .filter((check) => sha === head || check.app_id !== 57789)
      .map((check, i) => ({
        id: i + 1,
        name: check.context,
        app: { id: check.app_id },
        head_sha: sha,
        status: "completed",
        conclusion: "success",
      }));
  const headChecks = checks(head),
    mainChecks = checks(main);
  let prReads = 0;
  let mutateSecondRead = false;
  const api: GitHubReadApi = async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    const pathname = url.pathname.slice(1);
    if (pathname === "pulls/47") {
      prReads++;
      return structuredClone(
        mutateSecondRead && prReads > 1
          ? { ...pr, head: { ...pr.head, sha: "f".repeat(40) } }
          : pr,
      );
    }
    if (pathname === "branches/main/protection") return structuredClone(policy);
    if (pathname === "commits/main")
      return {
        sha: phase === "pr" ? base : main,
        commit: { tree: { sha: phase === "pr" ? "f".repeat(40) : tree } },
        parents: [{ sha: base }],
      };
    if (pathname === `commits/${head}`)
      return { sha: head, commit: { tree: { sha: tree } } };
    if (pathname === `commits/${merge}`)
      return {
        sha: merge,
        commit: { tree: { sha: tree } },
        parents: [{ sha: base }, { sha: head }],
      };
    if (pathname.endsWith("check-runs")) {
      assert.equal(url.searchParams.get("filter"), "all");
      const checkRuns = pathname.includes(head) ? headChecks : mainChecks;
      return {
        total_count: checkRuns.length,
        check_runs: structuredClone(checkRuns),
      };
    }
    if (pathname === "code-scanning/analyses") {
      const ref = url.searchParams.get("ref");
      return [
        {
          id: 30,
          ref,
          commit_sha:
            ref === "refs/pull/47/merge" ? merge : phase === "pr" ? base : main,
          tool: { name: "CodeQL" },
          error: "",
          results_count: 37,
        },
      ];
    }
    if (pathname === "code-scanning/alerts") return [];
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  return {
    api,
    pr,
    policy,
    headChecks,
    mainChecks,
    changeDuringRead: () => {
      mutateSecondRead = true;
    },
  };
}

test("PR evidence binds all eleven context/App checks to the exact head and security refs", async () => {
  const result = (await verifyGitHubCandidate(fixture().api, expected)) as {
    head: string;
    testedMerge: string;
    gates: unknown[];
    publicationReady: boolean;
    security: { ref: string }[];
  };
  assert.equal(result.head, head);
  assert.equal(result.testedMerge, merge);
  assert.equal(result.gates.length, 11);
  assert.deepEqual(
    result.security.map((scope) => scope.ref),
    ["refs/heads/main", "refs/pull/47/merge"],
  );
  assert.equal(result.publicationReady, false);
});

test("candidate snapshots preserve repository and fork identity", async () => {
  const f = fixture();
  f.pr.head.repo.full_name = "contributor/fork";
  const result = await verifyGitHubCandidate(f.api, expected);
  assert.equal(
    (result as unknown as { repository: string }).repository,
    "fixture/repo",
  );
  assert.equal(
    (result as unknown as { headRepository: string }).headRepository,
    "contributor/fork",
  );
});
test("stable candidate comparison accepts repeated observations with reordered checks", async () => {
  const before = await verifyGitHubCandidate(fixture().api, expected);
  const after = {
    ...before,
    recordedAt: "later",
    gates: [...before.gates].reverse(),
  };
  verifyStableCandidateSnapshot(before, after);
});
for (const field of ["id", "appId", "sha"] as const) {
  test(`stable candidate comparison rejects replaced check ${field} at an unchanged main`, async () => {
    const before = await verifyGitHubCandidate(fixture().api, expected);
    const after = structuredClone(before);
    const gate = after.gates[0]!;
    if (field === "sha") gate.sha = "f".repeat(40);
    else gate[field] += 1000;
    assert.throws(
      () => verifyStableCandidateSnapshot(before, after),
      /changed/u,
    );
  });
}
test("main evidence requires the ordinary squash tree and retains the PR checks", async () => {
  const result = (await verifyGitHubCandidate(fixture("main").api, {
    ...expected,
    phase: "main",
  })) as { main: string; gates: unknown[]; publicationReady: boolean };
  assert.equal(result.main, main);
  assert.equal(result.gates.length, 21);
  assert.equal(result.publicationReady, false);
});
for (const [name, mutate] of [
  [
    "a required check from another App",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks[0]!.app.id = 99;
    },
  ],
  [
    "a required check for another commit",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks[0]!.head_sha = base;
    },
  ],
  [
    "a pending check",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks[0]!.status = "in_progress";
    },
  ],
  [
    "a failed check",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks[0]!.conclusion = "failure";
    },
  ],
  [
    "a skipped check",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks[0]!.conclusion = "skipped";
    },
  ],
  [
    "a missing check",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks.shift();
    },
  ],
  [
    "an ambiguous repeated check",
    (f: ReturnType<typeof fixture>) => {
      f.headChecks.push({ ...f.headChecks[0]!, id: 200 });
    },
  ],
  [
    "weakened strict protection",
    (f: ReturnType<typeof fixture>) => {
      f.policy.required_status_checks.strict = false;
    },
  ],
  [
    "a removed required gate",
    (f: ReturnType<typeof fixture>) => {
      f.policy.required_status_checks.checks.shift();
    },
  ],
  [
    "a required gate no longer bound to its App",
    (f: ReturnType<typeof fixture>) => {
      f.policy.required_status_checks.checks[0]!.app_id = -1;
    },
  ],
  [
    "disabled linear history",
    (f: ReturnType<typeof fixture>) => {
      f.policy.required_linear_history.enabled = false;
    },
  ],
  [
    "a different PR head",
    (f: ReturnType<typeof fixture>) => {
      f.pr.head.sha = base;
    },
  ],
  [
    "a different PR base",
    (f: ReturnType<typeof fixture>) => {
      f.pr.base.sha = head;
    },
  ],
  [
    "a draft PR",
    (f: ReturnType<typeof fixture>) => {
      f.pr.draft = true;
    },
  ],
  [
    "a moved candidate during verification",
    (f: ReturnType<typeof fixture>) => {
      f.changeDuringRead();
    },
  ],
] as const) {
  test(`candidate evidence rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyGitHubCandidate(f.api, expected));
  });
}
test("a main check failure cannot reuse successful PR checks", async () => {
  const f = fixture("main");
  f.mainChecks[0]!.conclusion = "failure";
  await assert.rejects(
    verifyGitHubCandidate(f.api, { ...expected, phase: "main" }),
  );
});
test("a changed tested merge tree blocks a matching PR head", async () => {
  const f = fixture();
  const api: GitHubReadApi = async (endpoint) =>
    endpoint === `commits/${merge}`
      ? {
          sha: merge,
          commit: { tree: { sha: base } },
          parents: [{ sha: base }, { sha: head }],
        }
      : f.api(endpoint);
  await assert.rejects(verifyGitHubCandidate(api, expected));
});
test("an API permission failure cannot create passing candidate evidence", async () => {
  await assert.rejects(
    verifyGitHubCandidate(async () => {
      throw new Error("403");
    }, expected),
    /403/u,
  );
});
