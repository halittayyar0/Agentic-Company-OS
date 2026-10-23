import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fixture } from "./test-fixtures";
import { verifyRequiredProducers } from "./producers";

test("required Windows gate fails instead of skipping after unsuccessful installation", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const jobs = workflow.match(
    /^  windows-runtime:\n[\s\S]*?(?=^  [a-z][\w-]*:|$(?![\s\S]))/gmu,
  );
  assert.equal(jobs?.length, 1);
  const job = jobs![0]!;
  assert.match(job, /^    needs: windows-installation$/mu);
  assert.match(job, /^    if: \$\{\{ always\(\) \}\}$/mu);
  const first = job.split(/^      - name: /mu)[1]!;
  assert.match(first, /^Require complete Windows installation acceptance\n/u);
  assert.doesNotMatch(first, /^        if:/mu);
  assert.match(
    first,
    /^          INSTALLATION_RESULT: \$\{\{ needs\.windows-installation\.result \}\}$/mu,
  );
  const script = first.match(
    /^          node --input-type=module -e '(.*)'$/mu,
  )?.[1];
  assert.ok(
    script,
    "The first gate must execute the checked guard before any workload",
  );
  for (const result of [
    "success",
    "failure",
    "cancelled",
    "skipped",
    "",
    "unknown",
  ]) {
    const child: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        env: { ...process.env, INSTALLATION_RESULT: result },
        windowsHide: true,
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(
      child.status,
      result === "success" ? 0 : 1,
      `installation result ${result}`,
    );
  }
});

test("producer proof binds all ten original Actions gates and six native dependencies", async () => {
  const f = fixture();
  const proof = await verifyRequiredProducers(f.api, f.readLog, f.report);
  assert.equal(proof.length, 16);
});
test("main producer proof retains original PR provenance and binds the squash jobs", async () => {
  const f = fixture("main");
  const proof = await verifyRequiredProducers(f.api, f.readLog, f.report);
  assert.equal(proof.length, 32);
});

test("producer proof rejects missing or unbound Linux preparation and reusable-guide evidence", async () => {
  const name =
    "Local model preparation through native PostgreSQL and seven-language UI";
  const dependency = (f: ReturnType<typeof fixture>) =>
    f.jobs.find(
      (job) =>
        job.name === name &&
        job.head_sha ===
          (f.report.phase === "main" ? f.report.main : f.report.head),
    )!;
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.jobs.splice(f.jobs.indexOf(dependency(f)), 1);
    },
    (f) => {
      f.jobs.push({ ...dependency(f), id: 91 });
    },
    (f) => {
      dependency(f).head_sha = "f".repeat(40);
    },
    (f) => {
      dependency(f).run_id = 90;
    },
    (f) => {
      dependency(f).run_attempt = 2;
    },
    (f) => {
      const job = dependency(f);
      f.logs.set(
        job.id,
        f.logs
          .get(job.id)!
          .replaceAll(
            f.report.phase === "main" ? f.report.main : f.report.testedMerge,
            "f".repeat(40),
          ),
      );
    },
    ...[
      "Prove local model preparation and interrupted recovery in seven languages",
      "Prove seven-language reusable work through real API and workers",
      "Preserve model preparation evidence",
      "Preserve owned reusable-guide evidence",
    ].flatMap((required) => [
      (f: ReturnType<typeof fixture>) => {
        const job = dependency(f);
        job.steps = job.steps.filter((step) => step.name !== required);
      },
      (f: ReturnType<typeof fixture>) => {
        const job = dependency(f);
        job.steps.push({
          ...job.steps.find((step) => step.name === required)!,
        });
      },
      ...["failure", "cancelled", "skipped"].map(
        (conclusion) => (f: ReturnType<typeof fixture>) => {
          dependency(f).steps.find(
            (step) => step.name === required,
          )!.conclusion = conclusion;
        },
      ),
      (f: ReturnType<typeof fixture>) => {
        dependency(f).steps.find((step) => step.name === required)!.status =
          "in_progress";
      },
    ]),
  ];
  for (const phase of ["pr", "main"] as const) {
    for (const [index, mutate] of mutations.entries()) {
      const f = fixture(phase);
      mutate(f);
      await assert.rejects(
        verifyRequiredProducers(f.api, f.readLog, f.report),
        `${phase} Linux preparation dependency mutation ${index}`,
      );
    }
  }
});

test("Linux guide acceptance shares the preparation runner without relaxing release limits", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const jobs = [
    ...workflow.matchAll(
      /^  [a-z][\w-]*:\n[\s\S]*?(?=^  [a-z][\w-]*:|$(?![\s\S]))/gmu,
    ),
  ].map((match) => match[0]);
  const source = jobs.find((job) =>
    job.includes("name: Format, audit, test, typecheck, and build"),
  )!;
  const preparation = jobs.find((job) =>
    job.startsWith("  local-model-preparation:\n"),
  )!;
  assert.ok(source && preparation);
  assert.match(source, /^    timeout-minutes: 75$/mu);
  assert.match(preparation, /^    timeout-minutes: 25$/mu);
  const guide =
    "Prove seven-language reusable work through real API and workers";
  assert.equal(source.includes(guide), false);
  assert.equal(preparation.split(guide).length, 2);
  assert.match(
    preparation,
    /run: pnpm test:guides:native \/usr\/lib\/postgresql\/17\/bin/u,
  );
  assert.match(preparation, /ACOS_REUSABLE_GUIDES_SMOKE: "1"/u);
  assert.match(preparation, /name: reusable-guides-linux-native-evidence/u);
  assert.match(
    preparation,
    /name: Prove seven-language reusable work through real API and workers\n        id: linux-reusable-guides\n/u,
  );
  const guideUpload = preparation.slice(
    preparation.indexOf("name: Preserve owned reusable-guide evidence"),
  );
  // A preparation failure skips the guide command. Its shared failure file
  // must never be labelled as evidence from a guide that did not run.
  assert.match(
    guideUpload,
    /if: \$\{\{ always\(\) && \(steps\.linux-reusable-guides\.outcome == 'success' \|\| steps\.linux-reusable-guides\.outcome == 'failure' \|\| steps\.linux-reusable-guides\.outcome == 'cancelled'\) \}\}/u,
  );
  assert.ok(
    preparation.indexOf("name: Preserve model preparation evidence") <
      preparation.indexOf(`name: ${guide}`),
  );
  const ui = readFileSync(
    new URL("../../../playwright.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(ui, /workers: 2,/u);
  assert.match(ui, /retries: 0,/u);
  assert.equal(
    JSON.parse(
      readFileSync(
        new URL("../../release-expectations.json", import.meta.url),
        "utf8",
      ),
    ).linux.ui.tests,
    1465,
  );
});

test("producer proof rejects missing, unbound, or incomplete Windows installation evidence", async () => {
  const dependency = (f: ReturnType<typeof fixture>) =>
    f.jobs.find(
      (j) =>
        j.name === "Native installation Windows" &&
        j.head_sha ===
          (f.report.phase === "main" ? f.report.main : f.report.head),
    )!;
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.jobs.splice(f.jobs.indexOf(dependency(f)), 1);
    },
    (f) => {
      f.jobs.push({ ...dependency(f), id: 91 });
    },
    ...["failure", "cancelled", "skipped"].map(
      (conclusion) => (f: ReturnType<typeof fixture>) => {
        dependency(f).conclusion = conclusion;
      },
    ),
    (f) => {
      dependency(f).head_sha = "f".repeat(40);
    },
    (f) => {
      dependency(f).run_id = 90;
    },
    (f) => {
      dependency(f).run_attempt = 2;
    },
    (f) => {
      const j = dependency(f);
      f.logs.set(
        j.id,
        f.logs
          .get(j.id)!
          .replaceAll(
            f.report.phase === "main" ? f.report.main : f.report.testedMerge,
            "f".repeat(40),
          ),
      );
    },
    ...[
      "Prove native installation resume and binary backup restoration",
      "Prove seven-language first-job connection through real API and workers",
      "Prove seven-language reusable work through real API and workers",
    ].flatMap((name) =>
      ["failure", "skipped"].map(
        (conclusion) => (f: ReturnType<typeof fixture>) => {
          dependency(f).steps.find((s) => s.name === name)!.conclusion =
            conclusion;
        },
      ),
    ),
  ];
  for (const phase of ["pr", "main"] as const) {
    for (const [index, mutate] of mutations.entries()) {
      const f = fixture(phase);
      mutate(f);
      await assert.rejects(
        verifyRequiredProducers(f.api, f.readLog, f.report),
        `${phase} Windows dependency mutation ${index}`,
      );
    }
  }
});
for (const [name, mutate] of [
  [
    "CodeQL from workflow_dispatch",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(30)!.event = "workflow_dispatch";
    },
  ],
  [
    "Gitleaks from a scheduled run",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.event = "schedule";
    },
  ],
  [
    "coding helper from another workflow",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(50)!.path = ".github/workflows/ci.yml";
    },
  ],
  [
    "a restarted helper workflow",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(50)!.run_attempt = 2;
    },
  ],
  [
    "a job from another commit",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.head_sha = "f".repeat(40);
    },
  ],
  [
    "a failed original producer",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.conclusion = "failure";
    },
  ],
  [
    "a producer from another repository",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.repository.full_name = "other/repo";
    },
  ],
  [
    "a producer from another fork",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.head_repository.full_name = "other/fork";
    },
  ],
  [
    "a run linked to another PR",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.pull_requests = [
        {
          number: 48,
          head: { sha: f.report.head },
          base: { sha: f.report.base, ref: "main" },
        },
      ];
    },
  ],
  [
    "a run linked to another PR base",
    (f: ReturnType<typeof fixture>) => {
      f.runs.get(40)!.pull_requests = [
        {
          number: 47,
          head: { sha: f.report.head },
          base: { sha: "f".repeat(40), ref: "main" },
        },
      ];
    },
  ],
  [
    "a reused merge checkout",
    (f: ReturnType<typeof fixture>) => {
      f.logs.set(
        11,
        f.logs.get(11)!.replaceAll(f.report.testedMerge, "f".repeat(40)),
      );
    },
  ],
  [
    "a failed Mac dependency",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[4]!.conclusion = "failure";
    },
  ],
  [
    "an omitted Mac dependency",
    (f: ReturnType<typeof fixture>) => {
      f.jobs.splice(4, 1);
    },
  ],
  [
    "a duplicate original job",
    (f: ReturnType<typeof fixture>) => {
      f.jobs.push({ ...f.jobs[10]!, id: 81 });
    },
  ],
  [
    "a replaced required job identity",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.id = 82;
    },
  ],
  [
    "CI gates split across runs",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[8]!.run_id = 90;
      f.runs.set(90, { ...f.runs.get(10)!, id: 90 });
    },
  ],
  [
    "a skipped original checkout",
    (f: ReturnType<typeof fixture>) => {
      f.jobs[10]!.steps[0]!.conclusion = "skipped";
    },
  ],
  [
    "a missing required producer",
    (f: ReturnType<typeof fixture>) => {
      f.report.gates = f.report.gates.filter(
        (gate) => gate.name !== "Gitleaks history scan",
      );
    },
  ],
  [
    "a Mac dependency checking out another PR",
    (f: ReturnType<typeof fixture>) => {
      f.logs.set(
        5,
        f.logs.get(5)!.replaceAll("pull/47/merge", "pull/48/merge"),
      );
    },
  ],
] as const)
  test(`producer proof rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyRequiredProducers(f.api, f.readLog, f.report));
  });
test("main producer proof rejects a squash checkout of the old PR merge", async () => {
  const f = fixture("main");
  f.logs.set(
    111,
    f.logs.get(111)!.replaceAll(f.report.main, f.report.testedMerge),
  );
  await assert.rejects(verifyRequiredProducers(f.api, f.readLog, f.report));
});
