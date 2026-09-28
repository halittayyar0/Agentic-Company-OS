import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readBoundedRegularFile } from "./read-bounded-file";

test("bounded file reader reads the opened file and rejects oversize or non-regular inputs", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "acos-bounded-read-"),
  );
  const file = path.join(directory, "value.json");
  try {
    await fs.writeFile(file, "çin");
    assert.equal(await readBoundedRegularFile(file, 4), "çin");
    await assert.rejects(readBoundedRegularFile(file, 3), /limit/);
    await assert.rejects(readBoundedRegularFile(directory, 20));
    await assert.rejects(readBoundedRegularFile(file, -1), /limit/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bounded file reader holds one descriptor across path replacement", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "acos-stable-read-"),
  );
  const file = path.join(directory, "value.json");
  const replacement = path.join(directory, "replacement.json");
  const originalOpen = fs.open.bind(fs);
  try {
    await fs.writeFile(file, "old");
    await fs.writeFile(replacement, "replacement");
    const open = t.mock.method(
      fs,
      "open",
      async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        try {
          await fs.rename(replacement, file);
        } catch (error) {
          // Windows refuses replacing an open file; this also preserves identity.
          if (
            process.platform !== "win32" ||
            (error as NodeJS.ErrnoException).code !== "EPERM"
          ) {
            await handle.close();
            throw error;
          }
        }
        return handle;
      },
    );
    assert.equal(await readBoundedRegularFile(file, 3), "old");
    assert.equal(open.mock.callCount(), 1);
  } finally {
    t.mock.restoreAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
