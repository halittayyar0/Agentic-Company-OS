import type { GitHubReadApi } from "./github-security";
import type { verifyGitHubCandidate } from "./candidate";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { record } from "./github-security";
import { verifySourceTestLog } from "./source-log";
import { verifyUiTestLog } from "./ui-log";
import { readRunJobs, verifyRequiredProducers } from "./producers";
export type CandidateReport = Awaited<ReturnType<typeof verifyGitHubCandidate>>;
const stageDefinitions = [
  {
    key: "linux",
    name: "Format, audit, test, typecheck, and build",
    sourceStep: "Test",
    uiStep: "Run UI release smoke",
  },
  {
    key: "windows",
    name: "Windows runtime and process-tree regression",
    sourceStep: "Test Windows runtime paths",
  },
  {
    key: "macos-arm-source",
    name: "Native source tests macOS Apple Silicon",
    sourceStep: "Test native runtime and filesystem behavior",
  },
  {
    key: "macos-intel-source",
    name: "Native source tests macOS Intel",
    sourceStep: "Test native runtime and filesystem behavior",
  },
  {
    key: "macos-arm-ui",
    name: "Native installation and UI macOS Apple Silicon",
    uiStep: "Exercise first-run and capability library",
  },
  {
    key: "macos-intel-ui",
    name: "Native installation and UI macOS Intel",
    uiStep: "Exercise first-run and capability library",
  },
];
function requireStep(job: Record<string, unknown>, name: string) {
  assert.ok(Array.isArray(job.steps));
  const steps = job.steps.map(record).filter((step) => step.name === name);
  assert.equal(
    steps.length,
    1,
    `Missing or duplicate successful step: ${name}`,
  );
  assert.equal(steps[0]!.status, "completed");
  assert.equal(
    steps[0]!.conclusion,
    "success",
    `Step did not succeed: ${name}`,
  );
}
export async function verifyCandidateSuites(
  readApi: GitHubReadApi,
  readJobLog: (id: number) => Promise<string>,
  candidate: CandidateReport,
  expectations: unknown,
) {
  const responses = new Map<string, Promise<unknown>>();
  const logs = new Map<number, Promise<string>>();
  const api: GitHubReadApi = (endpoint) => {
    if (!responses.has(endpoint)) responses.set(endpoint, readApi(endpoint));
    return responses.get(endpoint)!;
  };
  const readLog = (id: number) => {
    if (!logs.has(id)) logs.set(id, readJobLog(id));
    return logs.get(id)!;
  };
  const configuration = record(expectations);
  assert.deepEqual(
    Object.keys(configuration).sort(),
    stageDefinitions.map((stage) => stage.key).sort(),
    "All six platform stages require reviewed expectations",
  );
  const producers = await verifyRequiredProducers(api, readLog, candidate);
  const sha = candidate.phase === "main" ? candidate.main : candidate.head;
  const gateJob = async (name: string) => {
    const gates = candidate.gates.filter(
      (gate) => gate.sha === sha && gate.name === name && gate.appId === 15368,
    );
    assert.equal(gates.length, 1, `Missing bound platform gate: ${name}`);
    const job = record(await api(`actions/jobs/${gates[0]!.id}`));
    assert.equal(job.id, gates[0]!.id);
    assert.equal(job.name, name);
    return job;
  };
  const linux = await gateJob(stageDefinitions[0]!.name);
  const windows = await gateJob(stageDefinitions[1]!.name);
  const arm = await gateJob("Native macOS Apple Silicon");
  const intel = await gateJob("Native macOS Intel");
  assert.equal(
    linux.run_id,
    windows.run_id,
    "Linux and Windows must come from the same original CI run",
  );
  assert.equal(
    arm.run_id,
    intel.run_id,
    "Both Mac gates must come from the same original platform run",
  );
  for (const [id, workflow] of [
    [linux.run_id, ".github/workflows/ci.yml"],
    [arm.run_id, ".github/workflows/platforms.yml"],
  ] as const) {
    assert.ok(Number.isSafeInteger(id) && Number(id) > 0);
    const run = record(await api(`actions/runs/${id}`));
    assert.equal(run.id, id);
    assert.equal(run.head_sha, sha, "Workflow belongs to another commit");
    assert.equal(run.path, workflow, "Wrong source workflow");
    assert.equal(
      run.event,
      candidate.phase === "pr" ? "pull_request" : "push",
      "Wrong workflow event",
    );
    if (candidate.phase === "main") assert.equal(run.head_branch, "main");
    assert.equal(run.status, "completed");
    assert.equal(run.conclusion, "success");
    assert.equal(
      run.run_attempt,
      1,
      "A restarted workflow needs explicit independent review",
    );
  }
  const macJobs = await readRunJobs(api, Number(arm.run_id));
  const proof = [];
  for (const stage of stageDefinitions) {
    let job: Record<string, unknown>;
    if (stage.key === "linux") job = linux;
    else if (stage.key === "windows") job = windows;
    else {
      const matches = macJobs.filter((job) => job.name === stage.name);
      assert.equal(
        matches.length,
        1,
        `Missing or ambiguous original job: ${stage.name}`,
      );
      job = record(await api(`actions/jobs/${matches[0]!.id}`));
      assert.equal(job.id, matches[0]!.id);
      assert.equal(job.run_id, arm.run_id);
    }
    assert.equal(job.head_sha, sha, "Job belongs to another commit");
    assert.equal(job.status, "completed");
    assert.equal(job.conclusion, "success");
    assert.equal(job.run_attempt, 1);
    assert.equal(job.name, stage.name);
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
    assert.ok(Number.isSafeInteger(job.id) && Number(job.id) > 0);
    const log = await readLog(Number(job.id));
    assert.equal(typeof log, "string");
    const expected = record(configuration[stage.key]);
    const source = stage.sourceStep
      ? (() => {
          const value = record(expected.source);
          assert.ok(
            Array.isArray(value.skippedCases) &&
              value.skippedCases.every((name) => typeof name === "string"),
          );
          return verifySourceTestLog(log, job, stage.sourceStep!, {
            tests: Number(value.tests),
            passed: Number(value.passed),
            skippedCases: value.skippedCases,
          });
        })()
      : null;
    const ui = stage.uiStep
      ? (() => {
          const value = record(expected.ui);
          const command =
            stage.key === "linux"
              ? "pnpm exec playwright test --config playwright.config.ts"
              : "pnpm exec playwright test --config playwright.config.ts tests/ui/language-setup.spec.ts tests/ui/skills-library.spec.ts --workers 1";
          return verifyUiTestLog(
            log,
            job,
            stage.uiStep!,
            command,
            Number(value.tests),
            Number(value.workers),
          );
        })()
      : null;
    if (stage.key === "linux")
      for (const name of [
        "Typecheck",
        "Build",
        "Verify generated API artifacts",
        "Audit production dependencies",
        "Audit development and build dependencies",
        "Check production dependency licenses",
        "Enforce frontend bundle budget",
      ])
        requireStep(job, name);
    if (stage.key === "windows")
      requireStep(job, "Prove native wall-clock evidence and verifier path");
    if (stage.key.endsWith("-ui"))
      for (const name of [
        "Build application and check types",
        "Prove native installation resume and binary backup restoration",
        "Prove seven-language first-job connection through real API and workers",
        "Prove seven-language reusable work through real API and workers",
        "Verify local database migration",
        "Preserve native installation and guided first-job evidence",
      ])
        requireStep(job, name);
    proof.push({
      key: stage.key,
      jobId: Number(job.id),
      runId: Number(job.run_id),
      logSha256: createHash("sha256").update(log).digest("hex"),
      source,
      ui,
    });
  }
  return { producers, stages: proof };
}
