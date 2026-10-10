import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verifyScopedCodeScanning,
  type GitHubReadApi,
} from "./github-security";

const sha = "a".repeat(40);
const scope = { ref: "refs/pull/46/merge", sha };
const analysis = {
  id: 10,
  ref: scope.ref,
  commit_sha: sha,
  tool: { name: "CodeQL" },
  error: "",
  results_count: 0,
};
function apiWith(
  analyses: unknown = [analysis],
  alerts: unknown = [],
): GitHubReadApi {
  return async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    assert.equal(url.searchParams.get("ref"), scope.ref);
    return url.pathname.endsWith("analyses") ? analyses : alerts;
  };
}

test("security proof records the exact queried ref and matching analysis", async () => {
  assert.deepEqual(await verifyScopedCodeScanning(apiWith(), [scope]), [
    { ref: scope.ref, sha, analysisIds: [10], openAlerts: 0 },
  ]);
});
test("an open PR instance blocks acceptance even when alert root state is null", async () => {
  await assert.rejects(
    verifyScopedCodeScanning(
      apiWith(
        [analysis],
        [
          {
            number: 50,
            state: null,
            most_recent_instance: { state: "open", ref: scope.ref },
          },
        ],
      ),
      [scope],
    ),
    /open.*alert/iu,
  );
});
test("main and PR scopes are both checked instead of relying on the default branch", async () => {
  const api: GitHubReadApi = async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    const ref = url.searchParams.get("ref");
    if (url.pathname.endsWith("analyses")) return [{ ...analysis, ref }];
    return ref === scope.ref
      ? [{ number: 50, state: null, most_recent_instance: { state: "open" } }]
      : [];
  };
  await assert.rejects(
    verifyScopedCodeScanning(api, [{ ref: "refs/heads/main", sha }, scope]),
    /open.*alert/iu,
  );
});
test("a hidden alert on the second page blocks acceptance", async () => {
  const api: GitHubReadApi = async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    if (url.pathname.endsWith("analyses")) return [analysis];
    if (url.searchParams.get("page") === "1")
      return Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
    return [
      { number: 101, state: null, most_recent_instance: { state: "open" } },
    ];
  };
  await assert.rejects(
    verifyScopedCodeScanning(api, [scope]),
    /Found 101 open/u,
  );
});

test("open alerts from another tool cannot be hidden by a CodeQL filter", async () => {
  const api: GitHubReadApi = async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    if (url.pathname.endsWith("analyses")) return [analysis];
    return url.searchParams.has("tool_name")
      ? []
      : [
          {
            number: 102,
            tool: { name: "Other" },
            most_recent_instance: { state: "open" },
          },
        ];
  };
  await assert.rejects(verifyScopedCodeScanning(api, [scope]), /Found 1 open/u);
});
test("analysis pagination finds the exact commit beyond the first page", async () => {
  const api: GitHubReadApi = async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    if (url.pathname.endsWith("alerts")) return [];
    return url.searchParams.get("page") === "1"
      ? Array.from({ length: 100 }, (_, i) => ({
          ...analysis,
          id: i + 20,
          commit_sha: "b".repeat(40),
        }))
      : [analysis];
  };
  assert.deepEqual(await verifyScopedCodeScanning(api, [scope]), [
    { ref: scope.ref, sha, analysisIds: [10], openAlerts: 0 },
  ]);
});
for (const [name, analyses] of [
  ["missing analysis", []],
  ["wrong commit", [{ ...analysis, commit_sha: "b".repeat(40) }]],
  ["wrong ref", [{ ...analysis, ref: "refs/heads/main" }]],
  ["failed analysis", [{ ...analysis, error: "database extraction failed" }]],
  [
    "missing error field",
    [{ id: 10, ref: scope.ref, commit_sha: sha, tool: { name: "CodeQL" } }],
  ],
  ["wrong tool", [{ ...analysis, tool: { name: "Other" } }]],
  ["malformed page", { message: "permission denied" }],
] as const) {
  test(`security proof rejects ${name}`, async () => {
    await assert.rejects(verifyScopedCodeScanning(apiWith(analyses), [scope]));
  });
}
test("a failed security API query cannot be accepted as zero alerts", async () => {
  await assert.rejects(
    verifyScopedCodeScanning(async () => {
      throw new Error("403");
    }, [scope]),
    /403/u,
  );
});
test("empty or invalid security scopes cannot create a passing proof", async () => {
  await assert.rejects(verifyScopedCodeScanning(apiWith(), []));
  await assert.rejects(
    verifyScopedCodeScanning(apiWith(), [{ ref: "main", sha }]),
  );
  await assert.rejects(
    verifyScopedCodeScanning(apiWith(), [{ ...scope, sha: "latest" }]),
  );
});
