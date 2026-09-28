import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { databaseBackend, dbReady, closeDatabase } from "@workspace/db";
import { createHash } from "node:crypto";
import {
  readTextFile,
  safeResolve,
  writeTextFile,
  writeBinaryFile,
  execInSandbox,
  listDirectory,
} from "./sandbox";

const base = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-file-editing-"));
process.env.AGENT_SANDBOX_ROOT = base;
test.after(async () => {
  await fsp.rm(base, { recursive: true, force: true });
  await closeDatabase();
});
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

test("directory snapshots bound enumeration and explicitly report omitted links and noncanonical paths", async () => {
  const directory = safeResolve(11, "folder").abs;
  await fsp.mkdir(directory, { recursive: true });
  assert.deepEqual(await listDirectory(11, "folder"), {
    path: "folder",
    entries: [],
    total: 0,
    truncated: false,
    skipped: 0,
  });
  const outside = path.join(base, "listing-target");
  await fsp.mkdir(outside);
  await fsp.symlink(
    outside,
    path.join(directory, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await fsp.writeFile(path.join(directory, "readable.txt"), "one");
  const partial = await listDirectory(11, "folder");
  assert.equal(partial.skipped, 1);
  assert.equal(partial.truncated, false);
  assert.equal(partial.total, 1);
  assert.equal(partial.entries[0].name, "readable.txt");
  for (let i = 0; i < 2000; i++)
    await fsp.writeFile(path.join(directory, `item-${i}.txt`), "");
  const bounded = await listDirectory(11, "folder");
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.entries.length + bounded.skipped, 2000);
  assert.equal(bounded.total, bounded.entries.length);
});

test("a missing file retains its domain error without exposing an absolute host path", async () => {
  await assert.rejects(readTextFile(10, "missing.txt"), (error: any) => {
    assert.match(error.message, /Dosya bulunamadi: missing.txt/);
    assert.equal(error.message.includes(base), false);
    return true;
  });
});

test("touch preserves existing bytes and creates a missing file", async () => {
  await writeTextFile(8, "existing.txt", "Keep 原文");
  let hooks = 0;
  assert.equal(
    (
      await execInSandbox(8, "touch existing.txt", 15000, async () => {
        hooks++;
      })
    ).ok,
    true,
  );
  assert.equal((await readTextFile(8, "existing.txt")).content, "Keep 原文");
  assert.equal((await execInSandbox(8, "touch created.txt")).ok, true);
  assert.equal((await readTextFile(8, "created.txt")).content, "");
  assert.equal(hooks, 1);
});

test(
  "native PostgreSQL file writers wait for the same workspace lock held by another connection",
  {
    skip:
      databaseBackend !== "postgresql"
        ? "DATABASE_URL is absent; native cross-connection file-lock proof is unavailable"
        : false,
  },
  async () => {
    await dbReady;
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [0x41434f46, 9],
      );
      pending = writeTextFile(9, "locked.txt", "once");
      // Observe the actual lock wait instead of treating elapsed time as proof.
      const deadline = Date.now() + 3500;
      let waiting = false;
      while (Date.now() < deadline) {
        const result = await client.query(
          "SELECT count(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = $2 AND NOT granted",
          [0x41434f46, 9],
        );
        if (Number(result.rows[0]?.count) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(waiting, true);
      await assert.rejects(fsp.stat(safeResolve(9, "locked.txt").abs), {
        code: "ENOENT",
      });
      await client.query("COMMIT");
      await pending;
      assert.equal((await readTextFile(9, "locked.txt")).content, "once");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await pending?.catch(() => undefined);
      await client.end();
    }
  },
);

test("a failed atomic replacement retains the original file and removes its temporary file", async () => {
  await writeTextFile(6, "record.txt", "keep");
  const originalRename = fsp.rename;
  try {
    fsp.rename = async () => {
      throw Object.assign(new Error("Simulated publication failure"), {
        code: "EACCES",
      });
    };
    await assert.rejects(
      writeTextFile(6, "record.txt", "replacement"),
      /Simulated publication failure/,
    );
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal((await readTextFile(6, "record.txt")).content, "keep");
  assert.deepEqual(
    await fsp.readdir(path.dirname(safeResolve(6, "record.txt").abs)),
    ["record.txt"],
  );
});

test("complete UTF-8 snapshots preserve BOM and bind a revision to exact bytes", async () => {
  const content = "\ufeffOriginal 原文\r\nتعليمات";
  await writeTextFile(1, "source.txt", content);
  const file = await readTextFile(1, "source.txt");
  assert.equal(file.content, content);
  assert.equal(file.version, hash(content));
  assert.equal(file.editable, true);
  assert.equal(file.truncated, false);
});

test("a truncated or non-UTF-8 preview can never be saved as a complete reviewed file", async () => {
  for (const [name, bytes] of [
    ["large.txt", Buffer.from("x".repeat(140000))],
    ["binary.txt", Buffer.from([0xff, 0xfe, 0, 65])],
    ["nul.txt", Buffer.from("hello\0world")],
  ] as const) {
    await writeBinaryFile(2, name, bytes);
    const file = await readTextFile(2, name);
    assert.equal(file.editable, false);
    await assert.rejects(
      writeTextFile(2, name, file.content, undefined, undefined, {
        expectedVersion: file.version,
      }),
      (error: any) => error.code === "VM_FILE_NOT_EDITABLE",
    );
    assert.deepEqual(await fsp.readFile(safeResolve(2, name).abs), bytes);
  }
});

test("create-only writes never truncate an existing file and concurrent creates have one winner", async () => {
  await writeTextFile(3, "exists.txt", "keep");
  await assert.rejects(
    writeTextFile(3, "exists.txt", "", undefined, undefined, {
      expectedVersion: "missing",
    }),
    (error: any) => error.code === "VM_FILE_CHANGED",
  );
  assert.equal((await readTextFile(3, "exists.txt")).content, "keep");
  const outcomes = await Promise.allSettled(
    ["first", "second"].map((content) =>
      writeTextFile(3, "race.txt", content, undefined, undefined, {
        expectedVersion: "missing",
      }),
    ),
  );
  assert.equal(
    outcomes.filter((value) => value.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((value) => value.status === "rejected").length,
    1,
  );
});

test("two writes from one reviewed revision cannot silently overwrite one another", async () => {
  await writeTextFile(4, "source.txt", "original");
  const version = (await readTextFile(4, "source.txt")).version;
  const outcomes = await Promise.allSettled(
    ["first", "second"].map((content) =>
      writeTextFile(4, "source.txt", content, undefined, undefined, {
        expectedVersion: version,
      }),
    ),
  );
  assert.equal(
    outcomes.filter((value) => value.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((value) => value.status === "rejected").length,
    1,
  );
  const committed = await readTextFile(4, "source.txt");
  assert.ok(["first", "second"].includes(committed.content));
  assert.equal(committed.version, hash(committed.content));
});

test("a changed file or an admission hook that changes it invalidates the reviewed revision", async () => {
  await writeTextFile(5, "source.txt", "original");
  const version = (await readTextFile(5, "source.txt")).version;
  await assert.rejects(
    writeTextFile(
      5,
      "source.txt",
      "stale",
      undefined,
      () => writeTextFile(5, "source.txt", "newer").then(() => undefined),
      { expectedVersion: version },
    ),
    (error: any) => error.code === "VM_FILE_CHANGED",
  );
  assert.equal((await readTextFile(5, "source.txt")).content, "newer");
  await assert.rejects(
    writeTextFile(5, "source.txt", "bad", undefined, undefined, {
      expectedVersion: "invalid",
    }),
    (error: any) => error.code === "VM_FILE_VERSION_REQUIRED",
  );
  assert.equal((await readTextFile(5, "source.txt")).content, "newer");
});
