import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { record, type GitHubReadApi } from "./github-security";
import type { CandidateReport } from "./suites";
import { requiredReleaseChecks } from "./candidate";
import { verifyCheckoutLog } from "./checkout";

const definitions = [
  {
    name: "Format, audit, test, typecheck, and build",
    workflow: "ci",
    checkout: "Check out repository",
  },
  {
    name: "Windows runtime and process-tree regression",
    workflow: "ci",
    checkout: "Check out repository",
  },
  {
    name: "Build and exercise production and endurance containers",
    workflow: "ci",
    checkout: "Check out repository",
  },
  {
    name: "Packaged Codex container permission and lifetime proof",
    workflow: "ci",
    checkout: "Check out repository",
  },
  {
    name: "Linux owned PID namespace lifetime",
    workflow: "ci",
    checkout: "Check out repository",
  },
  {
    name: "JavaScript and TypeScript analysis",
    workflow: "codeql",
    checkout: "Check out repository",
  },
  {
    name: "Gitleaks history scan",
    workflow: "secret-scan",
    checkout: "Check out complete history",
  },
  {
    name: "Coding helper known-live privacy and namespace regression",
    workflow: "coding-helper-regression",
    checkout: "Check out fixed source",
  },
  { name: "Native macOS Apple Silicon", workflow: "platforms", checkout: null },
  { name: "Native macOS Intel", workflow: "platforms", checkout: null },
];
export async function readRunJobs(api: GitHubReadApi, runId: number) {
  const jobs: Record<string, unknown>[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const data = record(
      await api(
        `actions/runs/${runId}/jobs?filter=all&per_page=100&page=${page}`,
      ),
    );
    assert.ok(
      Number.isSafeInteger(data.total_count) && Number(data.total_count) >= 0,
    );
    if (total === undefined) total = Number(data.total_count);
    assert.equal(data.total_count, total, "Job set changed during pagination");
    assert.ok(Array.isArray(data.jobs) && data.jobs.length <= 100);
    jobs.push(...data.jobs.map(record));
    if (data.jobs.length < 100) {
      assert.equal(jobs.length, total, "Incomplete job pagination");
      assert.equal(
        new Set(jobs.map((job) => job.id)).size,
        jobs.length,
        "Duplicate job ID",
      );
      return jobs;
    }
  }
  throw new Error("Job pagination did not finish");
}
function verifyOriginalJob(
  job: Record<string, unknown>,
  name: string,
  runId: number,
  sha: string,
) {
  assert.ok(Number.isSafeInteger(job.id) && Number(job.id) > 0);
  assert.equal(job.name, name, "Original job name changed");
  assert.equal(job.run_id, runId, "Job belongs to another run");
  assert.equal(job.head_sha, sha, "Job belongs to another commit");
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "success", "Original producer did not succeed");
  assert.equal(job.run_attempt, 1, "Job was restarted");
  assert.ok(Array.isArray(job.steps));
  assert.ok(
    job.steps
      .map(record)
      .every(
        (step) =>
          step.status === "completed" &&
          ["success", "skipped"].includes(String(step.conclusion)),
      ),
    "Incomplete or failed job step",
  );
}
export interface ProducerProof {
  sha: string;
  name: string;
  jobId: number;
  runId: number;
  workflow: string;
  event: "pull_request" | "push";
  checkout: ReturnType<typeof verifyCheckoutLog> | null;
  logSha256: string | null;
}
export async function verifyRequiredProducers(
  api: GitHubReadApi,
  readLog: (id: number) => Promise<string>,
  candidate: CandidateReport,
): Promise<ProducerProof[]> {
  assert.deepEqual(
    definitions.map((definition) => definition.name).sort(),
    requiredReleaseChecks
      .filter((check) => check.app_id === 15368)
      .map((check) => check.context)
      .sort(),
    "Producer definitions must cover the complete required Actions policy",
  );
  const proof: ProducerProof[] = [];
  for (const sha of candidate.phase === "main"
    ? [candidate.head, candidate.main]
    : [candidate.head]) {
    const isPr = sha === candidate.head;
    const event = isPr ? "pull_request" : "push";
    const expectedCheckout = {
      ref: isPr
        ? `refs/remotes/pull/${candidate.pr}/merge`
        : "refs/remotes/origin/main",
      sha: isPr ? candidate.testedMerge : candidate.main,
    };
    const gates = candidate.gates.filter(
      (gate) => gate.sha === sha && gate.appId === 15368,
    );
    assert.deepEqual(
      gates.map((gate) => gate.name).sort(),
      definitions.map((definition) => definition.name).sort(),
      "Missing or ambiguous required producer",
    );
    const workflows = new Map<
      string,
      { id: number; jobs: Record<string, unknown>[] }
    >();
    const capture = async (
      job: Record<string, unknown>,
      workflow: string,
      checkoutStep: string | null,
    ) => {
      const runId = Number(job.run_id);
      verifyOriginalJob(job, String(job.name), runId, sha);
      const log = checkoutStep ? await readLog(Number(job.id)) : null;
      const checkout =
        log === null
          ? null
          : verifyCheckoutLog(log, job, checkoutStep!, expectedCheckout);
      proof.push({
        sha,
        name: String(job.name),
        jobId: Number(job.id),
        runId,
        workflow,
        event,
        checkout,
        logSha256:
          log === null ? null : createHash("sha256").update(log).digest("hex"),
      });
    };
    for (const definition of definitions) {
      const gate = gates.find((gate) => gate.name === definition.name)!;
      const job = record(await api(`actions/jobs/${gate.id}`));
      assert.equal(job.id, gate.id, "Required producer identity changed");
      assert.equal(job.name, definition.name);
      assert.ok(Number.isSafeInteger(job.run_id) && Number(job.run_id) > 0);
      const runId = Number(job.run_id);
      const workflow = `.github/workflows/${definition.workflow}.yml`;
      const retained = workflows.get(workflow);
      if (retained)
        assert.equal(
          runId,
          retained.id,
          "Required gates must share the same original workflow run",
        );
      else {
        const run = record(await api(`actions/runs/${runId}`));
        assert.equal(run.id, runId);
        assert.equal(run.head_sha, sha, "Workflow belongs to another commit");
        assert.equal(run.path, workflow, "Wrong source workflow");
        assert.equal(run.event, event, "Wrong original workflow event");
        assert.equal(run.status, "completed");
        assert.equal(run.conclusion, "success");
        assert.equal(
          run.run_attempt,
          1,
          "A restarted workflow needs explicit independent review",
        );
        assert.equal(
          record(run.repository).full_name,
          candidate.repository,
          "Wrong workflow repository",
        );
        assert.equal(
          record(run.head_repository).full_name,
          isPr ? candidate.headRepository : candidate.repository,
          "Wrong workflow head repository",
        );
        if (!isPr) assert.equal(run.head_branch, "main");
        assert.ok(
          Array.isArray(run.pull_requests),
          "Missing workflow PR linkage metadata",
        );
        // GitHub can return [] for a valid closed PR. When linkage is present,
        // validate it too; the original checkout bytes always bind the merge.
        if (isPr && run.pull_requests.length) {
          assert.equal(
            run.pull_requests.length,
            1,
            "Ambiguous workflow PR linkage",
          );
          const linked = record(run.pull_requests[0]);
          assert.equal(linked.number, candidate.pr, "Wrong workflow PR");
          assert.equal(record(linked.head).sha, candidate.head);
          assert.equal(
            record(linked.base).sha,
            candidate.base,
            "Wrong workflow PR base",
          );
          assert.equal(record(linked.base).ref, "main");
        }
        workflows.set(workflow, {
          id: runId,
          jobs: await readRunJobs(api, runId),
        });
      }
      const matches = workflows
        .get(workflow)!
        .jobs.filter((row) => row.name === definition.name);
      assert.equal(
        matches.length,
        1,
        `Missing or ambiguous original job: ${definition.name}`,
      );
      assert.equal(
        matches[0]!.id,
        gate.id,
        "Required job does not match the original run",
      );
      if (definition.checkout === null) {
        const step = Array.isArray(job.steps)
          ? job.steps
              .map(record)
              .filter(
                (step) =>
                  step.name ===
                  "Require complete source and installation acceptance",
              )
          : [];
        assert.equal(step.length, 1);
        assert.equal(step[0]!.status, "completed");
        assert.equal(step[0]!.conclusion, "success");
      }
      await capture(job, workflow, definition.checkout);
    }
    const mac = workflows.get(".github/workflows/platforms.yml")!;
    for (const name of [
      "Native source tests macOS Apple Silicon",
      "Native source tests macOS Intel",
      "Native installation and UI macOS Apple Silicon",
      "Native installation and UI macOS Intel",
    ]) {
      const matches = mac.jobs.filter((job) => job.name === name);
      assert.equal(
        matches.length,
        1,
        `Missing or ambiguous original job: ${name}`,
      );
      assert.ok(
        Number.isSafeInteger(matches[0]!.id) && Number(matches[0]!.id) > 0,
      );
      const job = record(await api(`actions/jobs/${matches[0]!.id}`));
      assert.equal(job.id, matches[0]!.id);
      verifyOriginalJob(job, name, mac.id, sha);
      await capture(
        job,
        ".github/workflows/platforms.yml",
        "Check out repository",
      );
    }
  }
  return proof;
}
