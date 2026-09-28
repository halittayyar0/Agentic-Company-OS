import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { assertLocalTestEnvironment } from "./test-environment";
import { testLoaderUrl } from "./test-node-options";

test("general test preflight refuses database targets without revealing their values", () => {
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_FILE",
    "DATABASE_MIGRATIONS_DIR",
    "POSTGRES_RACE_TEST_DISPOSABLE",
    "POSTGRES_RACE_TEST_FAIL_IF_SKIPPED",
  ]) {
    for (const value of ["private-target-sentinel", " "]) {
      assert.throws(
        () => assertLocalTestEnvironment({ [name]: value }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /disposable/i);
          assert.ok(error.message.includes(name));
          assert.ok(!error.message.includes("private-target-sentinel"));
          return true;
        },
      );
    }
  }
});

test("general tests accept a clean development shell and reject production roles", () => {
  assert.doesNotThrow(() => assertLocalTestEnvironment({}));
  assert.doesNotThrow(() =>
    assertLocalTestEnvironment({
      DATABASE_URL: "",
      NODE_ENV: "test",
      RUNTIME_ROLE: "combined",
    }),
  );
  assert.throws(() => assertLocalTestEnvironment({ NODE_ENV: "production" }));
  assert.throws(() => assertLocalTestEnvironment({ RUNTIME_ROLE: "worker" }));
  assert.throws(() => assertLocalTestEnvironment({ RUNTIME_ROLE: "api" }));
});

test("the real general runner rejects a database before discovery or any connection", async (t) => {
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const target = `postgresql://private-test-user:private-test-password@127.0.0.1:${address.port}/existing_installation`;
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        testLoaderUrl,
        fileURLToPath(new URL("./run-tests.ts", import.meta.url)),
      ],
      {
        env: { ...process.env, DATABASE_URL: target },
        timeout: 10000,
        windowsHide: true,
      },
    ),
    (error: unknown) => {
      const failure = error as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr, /DATABASE_URL/);
      assert.match(failure.stderr, /disposable/i);
      assert.doesNotMatch(failure.stdout, /Discovered|Subtest|tests [0-9]/);
      assert.doesNotMatch(
        failure.stderr + failure.stdout,
        /private-test-|existing_installation/,
      );
      return true;
    },
  );
  assert.equal(connections, 0);
});
