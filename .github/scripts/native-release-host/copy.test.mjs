import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyDriverCopy } from "./copy.mjs";

async function fixture(t) {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, "acos-copy-unit-"));
  const source = path.join(root, "source"),
    copy = path.join(root, "copy");
  await mkdir(source);
  await mkdir(copy);
  for (const dir of [source, copy]) {
    await writeFile(
      path.join(dir, "guard.mjs"),
      "export const unitFixture = true;\n",
    );
    await writeFile(path.join(dir, "config.json"), "{}\n");
  }
  t.after(async () => {
    const checked = await realpath(root);
    assert.equal(path.dirname(checked), parent);
    assert.ok(path.basename(checked).startsWith("acos-copy-unit-"));
    await rm(checked, { recursive: true });
  });
  return { source, copy };
}
test("executed driver copy must match every immutable tracked driver byte", async (t) => {
  const { source, copy } = await fixture(t);
  const manifest = await verifyDriverCopy(source, copy);
  assert.deepEqual(
    manifest.map((x) => x.file),
    ["config.json", "guard.mjs"],
  );
  assert.ok(manifest.every((x) => /^[a-f0-9]{64}$/u.test(x.sha256)));
  await writeFile(
    path.join(copy, "guard.mjs"),
    "export const unitFixture = false;\n",
  );
  await assert.rejects(
    () => verifyDriverCopy(source, copy),
    /copied_driver_bytes_changed/,
  );
});
test("untracked executable helpers and code directories cannot be smuggled into the copy", async (t) => {
  const { source, copy } = await fixture(t);
  await writeFile(path.join(copy, "unexpected.mjs"), 'throw Error("unit");\n');
  await assert.rejects(
    () => verifyDriverCopy(source, copy),
    /unexpected_copied_driver_code/,
  );
});
