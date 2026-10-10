import assert from "node:assert/strict";
import { selectStepCommand } from "./step-log";
const action = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
export function verifyCheckoutLog(
  log: string,
  job: unknown,
  stepName: string,
  expected: { ref: string; sha: string },
) {
  assert.match(
    expected.ref,
    /^refs\/remotes\/(?:origin\/main|pull\/[1-9]\d*\/merge)$/u,
  );
  assert.match(expected.sha, /^[a-f0-9]{40}$/u);
  const selected = selectStepCommand(log, job, stepName, action);
  const commands = selected.selected.flatMap((row, index) => {
    const match =
      /^\[command\](?:"[^"]*[\\/]git(?:\.exe)?"|\/\S*\/git) (.+)$/u.exec(
        row.line,
      );
    return match ? [{ ...row, index, args: match[1]! }] : [];
  });
  const unique = (predicate: (args: string) => boolean, name: string) => {
    const matches = commands.filter((row) => predicate(row.args));
    assert.equal(
      matches.length,
      1,
      `A unique original ${name} command is required`,
    );
    const row = matches[0]!;
    assert.ok(
      selected.inWindow(row.timestamp),
      `${name} command is outside checkout step`,
    );
    return row;
  };
  const fetch = unique((args) => /(?:^| )fetch /u.test(args), "fetch");
  const checkout = unique((args) => args.startsWith("checkout "), "checkout");
  const head = unique((args) => args === "log -1 --format=%H", "HEAD");
  const refspec = `+${expected.sha}:${expected.ref}`;
  const fullMain = "+refs/heads/*:refs/remotes/origin/*";
  const fetchArgs = fetch.args.split(" ");
  assert.ok(fetchArgs.includes("origin"), "Checkout did not fetch from origin");
  assert.ok(
    fetchArgs.includes(refspec) ||
      (expected.ref === "refs/remotes/origin/main" &&
        fetchArgs.includes(fullMain)),
    "Fetch does not bind expected ref",
  );
  assert.ok(
    checkout.args === `checkout --progress --force ${expected.ref}` ||
      (expected.ref === "refs/remotes/origin/main" &&
        checkout.args ===
          `checkout --progress --force -B main ${expected.ref}`),
    "Checkout belongs to another ref",
  );
  assert.ok(
    fetch.index < checkout.index && checkout.index < head.index,
    "Checkout commands are out of order",
  );
  const output = selected.selected[head.index + 1];
  assert.ok(
    output && selected.inWindow(output.timestamp),
    "HEAD output is outside checkout step",
  );
  assert.equal(
    output.line,
    expected.sha,
    "Checkout HEAD differs from expected commit",
  );
  return { ref: expected.ref, sha: expected.sha, step: stepName, action };
}
