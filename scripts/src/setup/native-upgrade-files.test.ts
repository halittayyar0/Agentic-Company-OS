import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  nativeUpgradeHash,
  replaceNativeUpgradeFile,
} from "./native-upgrade-files";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(tmpdir()), "acos-upgrade-file-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "metadata.json");
  await fs.writeFile(file, "original", { mode: 0o600 });
  return { root, file };
}
test("upgrade file replacement is conditional, atomic and idempotent after interruption", async (t) => {
  const { file } = await fixture(t);
  await replaceNativeUpgradeFile(file, nativeUpgradeHash("original"), "new Ω");
  await replaceNativeUpgradeFile(file, nativeUpgradeHash("original"), "new Ω");
  assert.equal(await fs.readFile(file, "utf8"), "new Ω");
  await assert.rejects(
    replaceNativeUpgradeFile(file, nativeUpgradeHash("wrong"), "other"),
    /native_upgrade_file_changed/u,
  );
  assert.equal(await fs.readFile(file, "utf8"), "new Ω");
});
test("upgrade file replacement refuses hardlinked destinations without changing either link", async (t) => {
  const { root, file } = await fixture(t);
  const other = path.join(root, "linked");
  await fs.link(file, other);
  await assert.rejects(
    replaceNativeUpgradeFile(file, nativeUpgradeHash("original"), "other"),
  );
  assert.equal(await fs.readFile(file, "utf8"), "original");
  assert.equal(await fs.readFile(other, "utf8"), "original");
});
test("exhausted storage preserves the original and removes only its own incomplete temporary file", async (t) => {
  const { root, file } = await fixture(t);
  const probe = path.join(root, "probe");
  const handle = await fs.open(probe, "wx"),
    prototype = Object.getPrototypeOf(handle);
  await handle.close();
  await fs.unlink(probe);
  t.mock.method(prototype, "writeFile", async () => {
    throw Object.assign(new Error("injected storage exhaustion"), {
      code: "ENOSPC",
    });
  });
  try {
    await assert.rejects(
      replaceNativeUpgradeFile(file, nativeUpgradeHash("original"), "new"),
      { code: "ENOSPC" },
    );
  } finally {
    t.mock.restoreAll();
  }
  assert.equal(await fs.readFile(file, "utf8"), "original");
  assert.deepEqual(await fs.readdir(root), ["metadata.json"]);
});
