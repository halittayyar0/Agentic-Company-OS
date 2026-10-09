import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyFixtureBuildNetwork,
  parseFixtureBuildNetwork,
} from "./container-install-smoke-build";

test("a fixture build network changes only build networking inside its owned override", async () => {
  const fixture = await mkdtemp(
    path.join(tmpdir(), "acos-build-network-test-"),
  );
  try {
    const file = path.join(fixture, "compose.override.json");
    const original = {
      services: Object.fromEntries(
        ["app", "worker-1", "worker-2"].map((name) => [
          name,
          {
            environment: {
              ALLOW_AGENT_CODEX_TASKS: name === "app" ? "false" : "true",
            },
            secrets: ["database_url"],
            ports: name === "app" ? ["127.0.0.1:5100:5000"] : [],
          },
        ]),
      ),
      secrets: { database_url: { file: path.join(fixture, "private") } },
    };
    const serialized = JSON.stringify(original);
    await writeFile(file, serialized);
    const command = {
      command: "docker",
      args: [
        "compose",
        "--file",
        "compose.yaml",
        "--file",
        file,
        "up",
        "--detach",
        "--build",
      ],
    };
    await applyFixtureBuildNetwork(command, fixture, undefined);
    assert.equal(await readFile(file, "utf8"), serialized);
    await applyFixtureBuildNetwork(command, fixture, "host");
    const actual = JSON.parse(await readFile(file, "utf8"));
    for (const name of ["app", "worker-1", "worker-2"]) {
      assert.deepEqual(actual.services[name].build, { network: "host" });
      delete actual.services[name].build;
    }
    assert.deepEqual(actual, original);
    assert.equal(command.args.at(-1), "--build");
    await mkdir(path.join(fixture, "other"));
    await assert.rejects(
      applyFixtureBuildNetwork(command, path.join(fixture, "other"), "host"),
      /outside/,
    );
    assert.equal(parseFixtureBuildNetwork(undefined), undefined);
    assert.equal(parseFixtureBuildNetwork("host"), "host");
    assert.throws(() => parseFixtureBuildNetwork("bridge"), /unsupported/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
