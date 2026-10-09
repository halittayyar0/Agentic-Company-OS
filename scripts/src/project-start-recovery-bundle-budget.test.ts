import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { measureProjectStartRecoveryBundle } from "./project-start-recovery-bundle-budget";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const field = {
  title: "Recover",
  uncertain: "Unconfirmed",
  missing: "Not found yet",
  created: "Created",
  rejected: "Rejected",
  checking: "Checking",
  check: "Check",
  open: "Open",
  retry: "Retry same",
  prepare: "Prepare",
  stored: "Submitted",
  storageError: "Keep your draft",
  noTokens: "No model call",
  reasons: {
    EMERGENCY_STOP_ACTIVE: "Stop",
    AGENT_UNAVAILABLE: "Team",
    RUNTIME_CAPACITY_EXCEEDED: "Limit",
    EXECUTION_POLICY_DENIED: "Policy",
  },
};
const asset = (fileName: string, text: string) => ({
  fileName,
  contents: Buffer.from(text),
});
const fixture = () => [
  asset(
    "project-start-recovery-fixture.js",
    'const key="acos.project-start.v1";throw Error("invalid_receipt");',
  ),
  ...locales.map((locale) =>
    asset(
      `new-project-${locale}-fixture.js`,
      `const copy={recovery:${JSON.stringify(field)},draftStorageError:"Keep original draft",title:"Original form"};export{copy as default};`,
    ),
  ),
];
test("recovery credit includes one exclusive chunk and only authored recovery fields, never existing copy or vendor growth", () => {
  const f = fixture(),
    a = measureProjectStartRecoveryBundle(f);
  assert.ok(a.raw > f[0].contents.length);
  assert.ok(a.allLocaleRaw > a.raw - f[0].contents.length);
  const changed = [...f, asset("vendor-extra.js", "x".repeat(200000))];
  assert.deepEqual(measureProjectStartRecoveryBundle(changed), a);
  const grown = f.map((x, i) =>
    i === 0
      ? x
      : asset(
          x.fileName,
          x.contents
            .toString()
            .replace("Original form", "Original form".repeat(1000)),
        ),
  );
  const b = measureProjectStartRecoveryBundle(grown);
  assert.equal(b.raw, a.raw);
  assert.equal(b.allLocaleRaw, a.allLocaleRaw);
});
test("missing, duplicate, unrelated or oversized recovery assets cannot earn budget credit", () => {
  const f = fixture();
  for (const changed of [
    f.slice(0, -1),
    [...f, f[0]],
    [
      ...f.slice(0, -1),
      asset(f.at(-1)!.fileName, 'const c={recovery:{title:"Only one field"}};'),
    ],
    [
      asset(
        f[0].fileName,
        '"acos.project-start.v1";"invalid_receipt";' + "x".repeat(14000),
      ),
      ...f.slice(1),
    ],
  ])
    assert.throws(() => measureProjectStartRecoveryBundle(changed));
});
test("aggregate credit counts one locale peak and cannot hide unrelated growth beyond the existing ceiling", () => {
  const logic = fixture()[0];
  const controls = locales.map((locale, i) =>
    asset(
      `new-project-${locale}-fixture.js`,
      `const copy={title:${JSON.stringify("Existing form ".repeat(i === 0 ? 90 : 1))}};export{copy as default};`,
    ),
  );
  const current = controls.map((control, i) =>
    asset(
      control.fileName,
      control.contents
        .toString()
        .replace(
          "const copy={",
          `const copy={recovery:${JSON.stringify({ ...field, title: "Recovery ".repeat(i === 1 ? 100 : 1) })},`,
        ),
    ),
  );
  const compressed = (a: { contents: Buffer }) =>
    gzipSync(a.contents, { level: 9 }).length;
  const originalRaw = Math.max(...controls.map((a) => a.contents.length));
  const originalGzip = Math.max(...controls.map(compressed));
  const currentRaw =
    logic.contents.length + Math.max(...current.map((a) => a.contents.length));
  const currentGzip = compressed(logic) + Math.max(...current.map(compressed));
  const measured = measureProjectStartRecoveryBundle([logic, ...current]);
  // These are the actual inputs of the existing aggregate gate, independently
  // constructed without invoking recovery extraction to build the controls.
  assert.equal(currentRaw - measured.globalRaw, originalRaw);
  assert.equal(currentGzip - measured.globalGzip, originalGzip);
  assert.ok(currentRaw + 1 - measured.globalRaw > originalRaw);
  assert.ok(currentGzip + 1 - measured.globalGzip > originalGzip);
});
