import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "acos-mockup-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = mockupPreviewPlugin();
  (plugin.configResolved as (config: { root: string }) => void)({ root });
  return {
    root,
    async put(file: string) {
      const target = path.join(root, "src/components/mockups", file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        "export default function Preview() { return null; }",
      );
    },
    async scan() {
      await (plugin.buildStart as () => Promise<void>)();
      return readFile(
        path.join(root, "src/.generated/mockup-components.ts"),
        "utf8",
      );
    },
  };
}

test("preview discovery keeps nested and literal-brace filenames while excluding private helpers and non-files", async (t) => {
  const f = await fixture(t);
  for (const file of [
    "A.tsx",
    "nested/界面.tsx",
    "{literal}.tsx",
    "_helper.tsx",
    "_private/Hidden.tsx",
    ".hidden/Hidden.tsx",
    "notes.txt",
  ])
    await f.put(file);
  await mkdir(path.join(f.root, "src/components/mockups/Directory.tsx"));
  const source = await f.scan();
  assert.match(source, /components\/mockups\/A\.tsx/);
  assert.match(source, /nested\/界面\.tsx/);
  assert.match(source, /\{literal\}\.tsx/);
  assert.doesNotMatch(source, /helper|Hidden|notes|Directory|\\/);
});

test("a missing mockup directory generates an empty usable module", async (t) => {
  const f = await fixture(t);
  assert.match(await f.scan(), /export const modules: ModuleMap = \{\};/);
});

test("linked directories stay outside regular-file preview discovery", async (t) => {
  const f = await fixture(t);
  await f.put("Regular.tsx");
  const target = path.join(f.root, "linked-sources");
  await mkdir(target);
  await writeFile(
    path.join(target, "Linked.tsx"),
    "export default function Linked() { return null; }",
  );
  await symlink(
    target,
    path.join(f.root, "src/components/mockups/linked-preview"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const source = await f.scan();
  assert.match(source, /Regular\.tsx/);
  assert.doesNotMatch(source, /Linked\.tsx|linked-preview/);
});

test("rescans add and remove preview imports without retaining a deleted component", async (t) => {
  const f = await fixture(t);
  await f.put("Initial.tsx");
  const initial = await f.scan();
  assert.equal(await f.scan(), initial);
  await f.put("Added.tsx");
  assert.match(await f.scan(), /Added\.tsx/);
  await unlink(path.join(f.root, "src/components/mockups/Initial.tsx"));
  const final = await f.scan();
  assert.doesNotMatch(final, /Initial\.tsx/);
  assert.match(final, /Added\.tsx/);
});
