import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCheckoutLog } from "./checkout";
const sha = "d".repeat(40);
const ref = "refs/remotes/pull/47/merge";
const checkoutAction =
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
const expected = { ref, sha };
function fixture() {
  const job = {
    steps: [
      {
        name: "Check out repository",
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-10T00:00:00Z",
        completed_at: "2026-10-10T00:00:04Z",
      },
    ],
  };
  const lines = [
    `##[group]Run ${checkoutAction}`,
    `[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --depth=1 origin +${sha}:${ref}`,
    `[command]/usr/bin/git checkout --progress --force ${ref}`,
    "[command]/usr/bin/git log -1 --format=%H",
    sha,
  ];
  return {
    job,
    lines,
    log: () =>
      lines.map((line, i) => `2026-10-10T00:00:0${i}.123Z ${line}`).join("\n"),
  };
}
test("checkout proof binds the original PR merge ref and git HEAD output", () => {
  const f = fixture();
  const proof = verifyCheckoutLog(
    f.log(),
    f.job,
    "Check out repository",
    expected,
  );
  assert.deepEqual(proof, {
    ref,
    sha,
    step: "Check out repository",
    action: checkoutAction,
  });
});
test("checkout proof supports Windows git paths and a full-history main fetch", () => {
  const f = fixture();
  const mainRef = "refs/remotes/origin/main";
  f.lines[1] =
    "[command]/usr/bin/git -c protocol.version=2 fetch --no-tags origin +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/*";
  f.lines[2] = `[command]/usr/bin/git checkout --progress --force -B main ${mainRef}`;
  f.lines = f.lines.map((line) =>
    line.replace("/usr/bin/git", '"C:\\Program Files\\Git\\bin\\git.exe"'),
  );
  // log closes over the same array; replace contents to keep the fixture honest.
  const log = f.lines
    .map((line, i) => `2026-10-10T00:00:0${i}.123Z ${line}`)
    .join("\r\n");
  assert.deepEqual(
    verifyCheckoutLog(log, f.job, "Check out repository", {
      ref: mainRef,
      sha,
    }),
    { ref: mainRef, sha, step: "Check out repository", action: checkoutAction },
  );
});
test("checkout proof supports a complete-history PR refspec", () => {
  const f = fixture();
  f.lines[1] = `[command]/opt/homebrew/bin/git -c protocol.version=2 fetch --no-tags origin +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/* +${sha}:${ref}`;
  assert.equal(
    verifyCheckoutLog(f.log(), f.job, "Check out repository", expected)?.sha,
    sha,
  );
});
for (const [name, mutate] of [
  [
    "another merge SHA",
    (f: ReturnType<typeof fixture>) => {
      f.lines[4] = "b".repeat(40);
    },
  ],
  [
    "another PR ref",
    (f: ReturnType<typeof fixture>) => {
      f.lines[2] = f.lines[2]!.replace("/47/", "/48/");
    },
  ],
  [
    "a missing checkout step",
    (f: ReturnType<typeof fixture>) => {
      f.job.steps = [];
    },
  ],
  [
    "a failed checkout step",
    (f: ReturnType<typeof fixture>) => {
      f.job.steps[0]!.conclusion = "failure";
    },
  ],
  [
    "an unpinned checkout action",
    (f: ReturnType<typeof fixture>) => {
      f.lines[0] = "##[group]Run actions/checkout@v6";
    },
  ],
  [
    "a commit printed without git log",
    (f: ReturnType<typeof fixture>) => {
      f.lines[3] = "echo claimed commit";
    },
  ],
  [
    "a commit from another step",
    (f: ReturnType<typeof fixture>) => {
      f.job.steps[0]!.completed_at = "2026-10-10T00:00:02Z";
    },
  ],
  [
    "a checkout command after HEAD verification",
    (f: ReturnType<typeof fixture>) => {
      f.lines.push(f.lines[2]!);
    },
  ],
  [
    "a fetch from another remote",
    (f: ReturnType<typeof fixture>) => {
      f.lines[1] = f.lines[1]!.replace(" origin ", " upstream ");
    },
  ],
  [
    "a duplicate checkout step",
    (f: ReturnType<typeof fixture>) => {
      f.job.steps.push({ ...f.job.steps[0]! });
    },
  ],
  [
    "an ambiguous HEAD output",
    (f: ReturnType<typeof fixture>) => {
      f.lines.push(f.lines[3]!, f.lines[4]!);
    },
  ],
] as const) {
  test(`checkout proof rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() =>
      verifyCheckoutLog(f.log(), f.job, "Check out repository", expected),
    );
  });
}
