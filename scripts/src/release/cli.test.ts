import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseReleaseArguments, writeReleaseReport } from "./cli";
import { fixture } from "./test-fixtures";
import { testLoaderUrl } from "../test-node-options";
const args = [
  "--repo",
  "fixture/repo",
  "--phase",
  "pr",
  "--pr",
  "47",
  "--head",
  "a".repeat(40),
  "--base",
  "b".repeat(40),
  "--tree",
  "c".repeat(40),
  "--tested-merge",
  "d".repeat(40),
  "--output",
  "report.json",
];
test("actual CLI exits nonzero without candidate inputs and provides offline help", () => {
  const file = new URL("./cli.ts", import.meta.url);
  const invalid = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(file)],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(invalid.status, 1);
  const help = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(file), "--help"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--repo/u);
});

for (const changedChecks of [false, true])
  test(`actual CLI ${changedChecks ? "rejects replaced checks without a report" : "writes a complete source and producer report"}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "acos release cli "));
    const reportPath = path.join(directory, "report.json");
    const f = fixture();
    const requests: Record<string, { json?: unknown; raw?: string }> = {};
    const json = (endpoint: string, value: unknown) => {
      requests[endpoint] = { json: value };
    };
    json("pulls/47", {
      number: 47,
      state: "open",
      merged: false,
      draft: false,
      merge_commit_sha: f.report.testedMerge,
      head: {
        sha: f.report.head,
        repo: { full_name: f.report.headRepository },
      },
      base: {
        sha: f.report.base,
        ref: "main",
        repo: { full_name: f.report.repository },
      },
    });
    json("commits/main", { sha: f.report.base });
    json(`commits/${f.report.head}`, {
      sha: f.report.head,
      commit: { tree: { sha: f.report.tree } },
    });
    json(`commits/${f.report.testedMerge}`, {
      sha: f.report.testedMerge,
      commit: { tree: { sha: f.report.tree } },
      parents: [{ sha: f.report.base }, { sha: f.report.head }],
    });
    const { requiredReleaseChecks } = await import("./candidate");
    json("branches/main/protection", {
      required_status_checks: { strict: true, checks: requiredReleaseChecks },
      required_linear_history: { enabled: true },
    });
    json(`commits/${f.report.head}/check-runs?filter=all&per_page=100&page=1`, {
      total_count: f.report.gates.length,
      check_runs: f.report.gates.map((gate) => ({
        id: gate.id,
        name: gate.name,
        app: { id: gate.appId },
        head_sha: gate.sha,
        status: "completed",
        conclusion: "success",
      })),
    });
    for (const ref of ["refs/heads/main", "refs/pull/47/merge"]) {
      json(
        `code-scanning/analyses?ref=${encodeURIComponent(ref)}&tool_name=CodeQL&per_page=100&page=1`,
        [
          {
            id: 30,
            ref,
            commit_sha: ref.endsWith("/main")
              ? f.report.base
              : f.report.testedMerge,
            tool: { name: "CodeQL" },
            error: "",
            results_count: 0,
          },
        ],
      );
      json(
        `code-scanning/alerts?ref=${encodeURIComponent(ref)}&state=open&per_page=100&page=1`,
        [],
      );
    }
    const bytes = Buffer.from(JSON.stringify(f.expectations));
    json(`contents/scripts/release-expectations.json?ref=${f.report.head}`, {
      type: "file",
      path: "scripts/release-expectations.json",
      encoding: "base64",
      size: bytes.length,
      content: bytes.toString("base64"),
      sha: createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex"),
    });
    for (const job of f.jobs) {
      json(`actions/jobs/${job.id}`, job);
      requests[`actions/jobs/${job.id}/logs`] = { raw: f.logs.get(job.id)! };
    }
    for (const [id, run] of f.runs) {
      json(`actions/runs/${id}`, run);
      const jobs = f.jobs.filter((job) => job.run_id === id);
      json(`actions/runs/${id}/jobs?filter=all&per_page=100&page=1`, {
        total_count: jobs.length,
        jobs,
      });
    }
    try {
      await writeFile(
        path.join(directory, "fixture.json"),
        JSON.stringify({ changedChecks, requests }),
      );
      await writeFile(
        path.join(directory, "api"),
        `const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]!=='--method'||args[1]!=='GET')process.exit(2);const full=args.at(-1);const prefix='repos/fixture/repo/';if(!full.startsWith(prefix))process.exit(3);const key=full.slice(prefix.length);const data=JSON.parse(fs.readFileSync('fixture.json','utf8'));const response=data.requests[key];if(!response)process.exit(4);if(key.includes('/check-runs?')){let count=0;try{count=Number(fs.readFileSync('check-count','utf8'));}catch{}fs.writeFileSync('check-count',String(count+1));if(data.changedChecks&&count>0)response.json.check_runs[0].id+=1000;}process.stdout.write(response.raw===undefined?JSON.stringify(response.json):response.raw);`,
      );
      const actualArgs = args.slice(0, -2);
      const actual = spawnSync(
        process.execPath,
        [
          "--import",
          testLoaderUrl,
          fileURLToPath(new URL("./cli.ts", import.meta.url)),
          ...actualArgs,
          "--output",
          reportPath,
          "--gh",
          process.execPath,
        ],
        { cwd: directory, encoding: "utf8", windowsHide: true, timeout: 60000 },
      );
      if (changedChecks) {
        assert.equal(actual.status, 1, actual.stderr);
        assert.match(actual.stderr, /identities changed/u);
        await assert.rejects(readFile(reportPath), { code: "ENOENT" });
      } else {
        assert.equal(actual.status, 0, actual.stderr);
        const report = JSON.parse(await readFile(reportPath, "utf8"));
        assert.equal(report.publicationReady, false);
        assert.equal(report.suites.producers.length, 14);
        assert.equal(report.suites.stages.length, 6);
        assert.equal(report.sourceAndUiLogsPassed, true);
      }
    } finally {
      for (const name of ["api", "fixture.json", "check-count", "report.json"])
        await unlink(path.join(directory, name)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      await rmdir(directory);
    }
  });
test("CLI requires explicit candidate identity instead of selecting latest checks", () => {
  const result = parseReleaseArguments(args);
  assert.equal(result.repo, "fixture/repo");
  assert.equal(result.candidate.pr, 47);
  assert.equal(result.candidate.head, "a".repeat(40));
  assert.equal(result.output, path.resolve("report.json"));
});
for (const [name, changed] of [
  ["missing candidate field", args.slice(0, -4)],
  [
    "abbreviated SHA",
    args.map((arg) => (arg === "a".repeat(40) ? "abc123" : arg)),
  ],
  ["unknown argument", [...args, "--admin", "true"]],
  ["duplicate output", [...args, "--output", "another.json"]],
  [
    "repository path traversal",
    args.map((arg) => (arg === "fixture/repo" ? "fixture/../repo" : arg)),
  ],
  ["unknown phase", args.map((arg) => (arg === "pr" ? "latest" : arg))],
  ["non-numeric PR", args.map((arg) => (arg === "47" ? "47suffix" : arg))],
] as const) {
  test(`CLI rejects ${name}`, () => {
    assert.throws(() => parseReleaseArguments(changed));
  });
}
test("report output is readable JSON and cannot overwrite previous evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "acos-release-cli-"));
  const file = path.join(directory, "report.json");
  try {
    await writeReleaseReport(file, {
      checksAndSecurityPassed: true,
      publicationReady: false,
    });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      checksAndSecurityPassed: true,
      publicationReady: false,
    });
    await assert.rejects(
      writeReleaseReport(file, { publicationReady: true }),
      /EEXIST/u,
    );
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).publicationReady,
      false,
    );
  } finally {
    await unlink(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(directory);
  }
});
