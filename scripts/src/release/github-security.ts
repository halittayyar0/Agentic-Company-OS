import assert from "node:assert/strict";

export type GitHubReadApi = (path: string) => Promise<unknown>;
export function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected an API object",
  );
  return value as Record<string, unknown>;
}
export async function readArrayPages(
  api: GitHubReadApi,
  endpoint: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await api(`${endpoint}&per_page=100&page=${page}`);
    assert.ok(Array.isArray(response), "Expected an API result page");
    assert.ok(response.length <= 100, "Oversized API result page");
    rows.push(...response);
    if (response.length < 100) return rows;
  }
  throw new Error("Security result pagination did not finish");
}
export interface SecurityScope {
  ref: string;
  sha: string;
}
export async function verifyScopedCodeScanning(
  api: GitHubReadApi,
  scopes: readonly SecurityScope[],
): Promise<
  { ref: string; sha: string; analysisIds: number[]; openAlerts: number }[]
> {
  assert.ok(
    scopes.length > 0,
    "At least one explicit security scope is required",
  );
  assert.equal(
    new Set(scopes.map((scope) => scope.ref)).size,
    scopes.length,
    "Duplicate security scope",
  );
  const proof = [];
  for (const scope of scopes) {
    assert.match(
      scope.ref,
      /^refs\/(?:heads\/[A-Za-z0-9._/-]+|pull\/[1-9]\d*\/merge)$/u,
      "Explicit Git ref required",
    );
    assert.match(scope.sha, /^[a-f0-9]{40}$/u, "Exact commit required");
    const query = `ref=${encodeURIComponent(scope.ref)}&tool_name=CodeQL`;
    const analyses = (
      await readArrayPages(api, `code-scanning/analyses?${query}`)
    ).map(record);
    const matching = analyses.filter(
      (analysis) =>
        analysis.commit_sha === scope.sha &&
        analysis.ref === scope.ref &&
        record(analysis.tool).name === "CodeQL",
    );
    assert.ok(
      matching.length > 0,
      "Missing CodeQL analysis for the exact ref and commit",
    );
    const analysisIds = matching.map((analysis) => {
      assert.equal(analysis.error, "", "CodeQL analysis did not succeed");
      assert.ok(
        Number.isSafeInteger(analysis.id) && Number(analysis.id) > 0,
        "Invalid analysis ID",
      );
      assert.ok(
        Number.isSafeInteger(analysis.results_count) &&
          Number(analysis.results_count) >= 0,
        "Incomplete CodeQL analysis",
      );
      return Number(analysis.id);
    });
    assert.equal(
      new Set(analysisIds).size,
      analysisIds.length,
      "Duplicate analysis ID",
    );
    // Do not filter by the root alert state: PR alerts can have state:null with
    // an open most_recent_instance. Every result from this scoped open query
    // blocks acceptance, including a malformed or unrecognized result.
    const alerts = await readArrayPages(
      api,
      `code-scanning/alerts?ref=${encodeURIComponent(scope.ref)}&state=open`,
    );
    assert.equal(
      alerts.length,
      0,
      `Found ${alerts.length} open code-scanning alert(s) in ${scope.ref}`,
    );
    proof.push({ ...scope, analysisIds, openAlerts: 0 });
  }
  return proof;
}
