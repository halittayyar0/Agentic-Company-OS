import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  browserLaunchCommand,
  readNativeLaunchPointer,
  saveNativeLaunchPointer,
} from "./native-launch";

test("native browser launch uses fixed programs and only the private loopback URL", () => {
  const url = "http://127.0.0.1:58042/#private-setup-fragment";
  assert.deepEqual(browserLaunchCommand(url, "darwin"), {
    command: "/usr/bin/open",
    args: [url],
  });
  assert.deepEqual(browserLaunchCommand(url, "linux"), {
    command: "xdg-open",
    args: [url],
  });
  assert.equal(browserLaunchCommand(url, "win32").args.at(-1), url);
  for (const value of [
    "https://external.example/",
    "http://localhost:5000/",
    "file:///secret",
    "http://name:password@127.0.0.1:5000/",
    "http://127.0.0.1:5000/?token=secret",
  ])
    assert.throws(() => browserLaunchCommand(value, "linux"));
});

test("native launch remembers one exact private installation and refuses an unrelated checkout or changed pointer", async (t) => {
  const parent = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-native-launch-"),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = process.cwd(),
    commit = "a".repeat(40);
  assert.equal(await readNativeLaunchPointer(parent, root, commit), null);
  const directory = path.join(
    parent,
    "instance-12345678-1234-1234-1234-123456789012",
  );
  await saveNativeLaunchPointer(parent, root, commit, directory);
  assert.equal(await readNativeLaunchPointer(parent, root, commit), directory);
  await assert.rejects(
    readNativeLaunchPointer(parent, path.join(root, "other"), commit),
  );
  await assert.rejects(readNativeLaunchPointer(parent, root, "b".repeat(40)));
  const file = path.join(parent, "native-launch.json");
  const pointer = JSON.parse(await readFile(file, "utf8"));
  await writeFile(
    file,
    JSON.stringify({ ...pointer, directory: path.dirname(parent) }),
  );
  await assert.rejects(readNativeLaunchPointer(parent, root, commit));
});
