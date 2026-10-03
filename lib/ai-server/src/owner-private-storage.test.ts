import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OwnerPrivateStorage,
  assertPrivateUnixMetadata,
  windowsOwnerSid,
} from "./owner-private-storage";

test("private storage protects secrets before atomic writes and survives reopening", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "acos-private-vault-"));
  try {
    const directory = path.join(parent, "vault");
    const storage = new OwnerPrivateStorage(directory);
    await storage.initialize();
    await storage.write("record.json", "first-secret");
    await storage.write("record.json", "replacement-secret");
    const reopened = new OwnerPrivateStorage(directory);
    await reopened.initialize();
    assert.equal(await reopened.read("record.json"), "replacement-secret");
    assert.equal(await reopened.read("missing.json"), null);
    await assert.rejects(storage.write("../escape", "secret"));
    await assert.rejects(storage.write("record.json:stream", "secret"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("private storage refuses redirected directories and nonregular secret files", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "acos-private-links-"));
  try {
    const storage = new OwnerPrivateStorage(path.join(parent, "vault"));
    await storage.initialize();
    const alias = path.join(parent, "alias");
    await symlink(
      storage.directory,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      new OwnerPrivateStorage(alias).initialize(),
      /private_storage/,
    );
    await symlink(
      parent,
      path.join(storage.directory, "record.json"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(storage.read("record.json"), /private_storage/);
    await assert.rejects(
      storage.write("record.json", "secret"),
      /private_storage/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Unix owner protection rejects wrong owners, public bits and links", () => {
  assert.doesNotThrow(() =>
    assertPrivateUnixMetadata(
      {
        uid: 42,
        mode: 0o700,
        isDirectory: true,
        isFile: false,
        isSymbolicLink: false,
      },
      42,
      true,
    ),
  );
  for (const patch of [
    { uid: 43 },
    { mode: 0o750 },
    { isSymbolicLink: true },
    { isDirectory: false },
  ]) {
    assert.throws(
      () =>
        assertPrivateUnixMetadata(
          {
            uid: 42,
            mode: 0o700,
            isDirectory: true,
            isFile: false,
            isSymbolicLink: false,
            ...patch,
          },
          42,
          true,
        ),
      /private_storage/,
    );
  }
  assert.throws(
    () =>
      assertPrivateUnixMetadata(
        {
          uid: 42,
          mode: 0o640,
          isDirectory: false,
          isFile: true,
          isSymbolicLink: false,
        },
        42,
        false,
      ),
    /private_storage/,
  );
});

test("Windows owner parsing accepts Entra accounts and rejects ambiguous identity", () => {
  assert.equal(
    windowsOwnerSid('"azuread\\operator","S-1-12-1-123-456-789-10"'),
    "S-1-12-1-123-456-789-10",
  );
  assert.throws(() =>
    windowsOwnerSid('"user","S-1-5-21-1"\n"other","S-1-5-21-2"'),
  );
});

test("private storage fails closed after protection is weakened", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "acos-private-denied-"));
  try {
    const storage = new OwnerPrivateStorage(path.join(parent, "vault"));
    await storage.initialize();
    await storage.write("record.json", "original-secret");
    if (process.platform === "win32") {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)(
        path.join(process.env.SystemRoot!, "System32", "icacls.exe"),
        [storage.directory, "/grant", "*S-1-1-0:(OI)(CI)R"],
        { windowsHide: true },
      );
    } else {
      await chmod(storage.directory, 0o755);
    }
    await assert.rejects(
      storage.write("record.json", "replacement-secret"),
      /private_storage/,
    );
    assert.equal(
      await readFile(path.join(storage.directory, "record.json"), "utf8"),
      "original-secret",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
