import assert from "node:assert/strict";
import type { GitHubReadApi } from "./github-security";
import type { CandidateReport } from "./suites";

export const head = "a".repeat(40);
export const stages = [
  "linux",
  "windows",
  "macos-arm-source",
  "macos-intel-source",
  "macos-arm-ui",
  "macos-intel-ui",
];
export function fixture(phase: "pr" | "main" = "pr") {
  const names = [
    "Format, audit, test, typecheck, and build",
    "Windows runtime and process-tree regression",
    "Native macOS Apple Silicon",
    "Native macOS Intel",
    "Native source tests macOS Apple Silicon",
    "Native source tests macOS Intel",
    "Native installation and UI macOS Apple Silicon",
    "Native installation and UI macOS Intel",
    "Build and exercise production and endurance containers",
    "JavaScript and TypeScript analysis",
    "Gitleaks history scan",
    "Packaged Codex container permission and lifetime proof",
    "Linux owned PID namespace lifetime",
    "Coding helper known-live privacy and namespace regression",
  ];
  const stepNames = [
    "Test",
    "Test Windows runtime paths",
    "Test native runtime and filesystem behavior",
    "Run UI release smoke",
    "Exercise first-run and capability library",
    "Typecheck",
    "Build",
    "Verify generated API artifacts",
    "Audit production dependencies",
    "Audit development and build dependencies",
    "Check production dependency licenses",
    "Enforce frontend bundle budget",
    "Prove native wall-clock evidence and verifier path",
    "Build application and check types",
    "Prove native installation resume and binary backup restoration",
    "Prove seven-language first-job connection through real API and workers",
    "Prove seven-language reusable work through real API and workers",
    "Verify local database migration",
    "Preserve native installation and guided first-job evidence",
    "Require complete source and installation acceptance",
  ];
  const step = (name: string) => ({
    name,
    status: "completed",
    conclusion: "success",
    started_at: "2026-10-10T00:00:00Z",
    completed_at: "2026-10-10T00:01:00Z",
  });
  const phases = phase === "main" ? ["pr", "main"] : ["pr"];
  const runs = new Map<
    number,
    {
      id: number;
      head_sha: string;
      event: string;
      path: string;
      head_branch: string;
      status: string;
      conclusion: string;
      run_attempt: number;
      repository: { full_name: string };
      head_repository: { full_name: string };
      pull_requests: {
        number: number;
        head: { sha: string };
        base: { sha: string; ref: string };
      }[];
    }
  >();
  const jobs: {
    id: number;
    name: string;
    head_sha: string;
    run_id: number;
    run_attempt: number;
    status: string;
    conclusion: string;
    steps: ReturnType<typeof step>[];
  }[] = [];
  const logs = new Map<number, string>();
  for (const current of phases) {
    const offset = current === "main" ? 100 : 0;
    const sha = current === "main" ? "e".repeat(40) : head;
    const checkoutSha = current === "main" ? sha : "d".repeat(40);
    const ref =
      current === "main"
        ? "refs/remotes/origin/main"
        : "refs/remotes/pull/47/merge";
    for (const [runId, path] of [
      [10, ".github/workflows/ci.yml"],
      [20, ".github/workflows/platforms.yml"],
      [30, ".github/workflows/codeql.yml"],
      [40, ".github/workflows/secret-scan.yml"],
      [50, ".github/workflows/coding-helper-regression.yml"],
    ] as const)
      runs.set(runId + offset, {
        id: runId + offset,
        head_sha: sha,
        event: current === "main" ? "push" : "pull_request",
        path,
        head_branch: current === "main" ? "main" : "codex/feature",
        status: "completed",
        conclusion: "success",
        run_attempt: 1,
        repository: { full_name: "fixture/repo" },
        head_repository: { full_name: "fixture/repo" },
        pull_requests: [],
      });
    names.forEach((name, i) => {
      const id = i + 1 + offset;
      const aggregate = i === 2 || i === 3;
      const runId =
        (i >= 2 && i <= 7
          ? 20
          : i === 9
            ? 30
            : i === 10
              ? 40
              : i === 13
                ? 50
                : 10) + offset;
      const checkoutStep = step(
        i === 10
          ? "Check out complete history"
          : i === 13
            ? "Check out fixed source"
            : "Check out repository",
      );
      checkoutStep.completed_at = "2026-10-10T00:00:04Z";
      jobs.push({
        id,
        name,
        head_sha: sha,
        run_id: runId,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        steps: [...(aggregate ? [] : [checkoutStep]), ...stepNames.map(step)],
      });
      const checkout = [
        `##[group]Run actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803`,
        `[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --depth=1 origin +${checkoutSha}:${ref}`,
        `[command]/usr/bin/git checkout --progress --force ${current === "main" ? "-B main " : ""}${ref}`,
        "[command]/usr/bin/git log -1 --format=%H",
        checkoutSha,
      ]
        .map((line, j) => `2026-10-10T00:00:0${j}.123Z ${line}`)
        .join("\n");
      const source =
        "2026-10-10T00:00:10Z ##[group]Run pnpm test\n" +
        ["tests 2", "pass 2", "fail 0", "cancelled 0", "skipped 0"]
          .map((label) => `2026-10-10T00:00:20Z ℹ ${label}`)
          .join("\n");
      const ui = (command: string, workers: number) =>
        `2026-10-10T00:00:30Z ##[group]Run ${command}\n2026-10-10T00:00:31Z Running 2 tests using ${workers} worker${workers > 1 ? "s" : ""}\n2026-10-10T00:00:55Z   2 passed (24s)`;
      logs.set(
        id,
        [
          checkout,
          ...(i === 6 || i === 7
            ? [
                ui(
                  "pnpm exec playwright test --config playwright.config.ts tests/ui/language-setup.spec.ts tests/ui/skills-library.spec.ts --workers 1",
                  1,
                ),
              ]
            : [
                source,
                ...(i === 0
                  ? [
                      ui(
                        "pnpm exec playwright test --config playwright.config.ts",
                        2,
                      ),
                    ]
                  : []),
              ]),
        ].join("\n"),
      );
    });
  }
  const report = {
    schema: "agentic-company-os/release-checks@1",
    recordedAt: "now",
    phase,
    pr: 47,
    head,
    base: "b".repeat(40),
    tree: "c".repeat(40),
    testedMerge: "d".repeat(40),
    main: phase === "main" ? "e".repeat(40) : "b".repeat(40),
    repository: "fixture/repo",
    headRepository: "fixture/repo",
    checksAndSecurityPassed: true,
    publicationReady: false,
    security: [],
    scope: "fixture",
    gates: [
      ...jobs
        .filter(
          (job) =>
            !job.name.startsWith("Native source") &&
            !job.name.startsWith("Native installation"),
        )
        .map((job) => ({
          sha: job.head_sha,
          name: job.name,
          appId: 15368,
          id: job.id,
        })),
      { sha: head, name: "CodeQL", appId: 57789, id: 99 },
    ],
  } as CandidateReport;
  const expectations: Record<
    string,
    {
      source?: { tests: number; passed: number; skippedCases: string[] };
      ui?: { tests: number; workers: number };
    }
  > = Object.fromEntries(
    stages.map((key) => [
      key,
      key.endsWith("-ui")
        ? { ui: { tests: 2, workers: 1 } }
        : {
            source: { tests: 2, passed: 2, skippedCases: [] },
            ...(key === "linux" ? { ui: { tests: 2, workers: 2 } } : {}),
          },
    ]),
  );
  const api: GitHubReadApi = async (endpoint) => {
    const url = new URL(endpoint, "https://fixture.invalid/");
    if (url.pathname.startsWith("/actions/jobs/"))
      return structuredClone(
        jobs.find((job) => job.id === Number(url.pathname.split("/")[3])),
      );
    const runId = Number(url.pathname.split("/")[3]);
    if (url.pathname.endsWith("/jobs")) {
      const runJobs = jobs.filter((job) => job.run_id === runId);
      return { total_count: runJobs.length, jobs: structuredClone(runJobs) };
    }
    return structuredClone(runs.get(runId));
  };
  return {
    api,
    logs,
    jobs,
    runs,
    expectations,
    report,
    readLog: async (id: number) => {
      const log = logs.get(id);
      assert.ok(log);
      return log;
    },
  };
}
