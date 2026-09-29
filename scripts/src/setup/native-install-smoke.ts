import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { reserveLoopbackPorts } from "../endurance/native-postgres-harness";
import { createInstallationExecutor } from "./installer";
import { planInstallation } from "./plan";
import { detectInstallCapabilities } from "./preflight";
import { applyInstallationPreferences } from "./preferences";
import { readInstallation } from "./resume";

// Opt-in real native installation proof. Owns a fresh PostgreSQL cluster and
// keeps its evidence directory; it never attaches to the operator's database.
export async function runNativeInstallSmoke(
  postgresBin: string,
  pnpmPath: string,
  acceptance?: {
    providerKey: string;
    run: (context: {
      baseUrl: string;
      operatorToken: string;
      directory: string;
    }) => Promise<void>;
  },
) {
  const source = fileURLToPath(new URL("../../..", import.meta.url));
  const directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-native-install-proof-"),
  );
  const [dbPort, appPort] = await reserveLoopbackPorts(2);
  const password = randomBytes(32).toString("hex"),
    data = path.join(directory, "postgres-data");
  const passwordFile = path.join(directory, "password");
  await writeFile(passwordFile, password, { mode: 0o600 });
  const exe = (name: string) =>
    path.join(postgresBin, name + (process.platform === "win32" ? ".exe" : ""));
  const command = (name: string, args: string[]) =>
    executeBoundedCommand({
      command: exe(name),
      args,
      cwd: directory,
      environment: { ...process.env, PGPASSWORD: password },
      timeoutMs: 60000,
      maxBufferBytes: 1024 * 1024,
      ignoreInheritedStdio: true,
    });
  let started = false;
  let executor: ReturnType<typeof createInstallationExecutor> | undefined;
  const checks: string[] = [];
  try {
    await command("initdb", [
      "-D",
      data,
      "-U",
      "setup_proof",
      "--auth=scram-sha-256",
      "--pwfile",
      passwordFile,
      "--encoding=UTF8",
      "--locale=C",
    ]);
    await command("pg_ctl", [
      "-D",
      data,
      "-l",
      path.join(directory, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${dbPort}`,
      "-w",
      "start",
    ]);
    started = true;
    await command("createdb", [
      "-h",
      "127.0.0.1",
      "-p",
      String(dbPort),
      "-U",
      "setup_proof",
      "setup_proof",
    ]);
    const plan = planInstallation(
      {
        mode: "native",
        locale: "ar",
        port: appPort,
        accessMode: "read_only",
        provider: acceptance ? "openrouter" : "later",
        phoneAccess: "local",
        toolPacks: ["data", "documents"],
      },
      await detectInstallCapabilities(),
    );
    const options = {
      workspaceRoot: source,
      installationParent: directory,
      pnpmPath,
      applyPreferences: applyInstallationPreferences,
    };
    executor = createInstallationExecutor(options);
    const result = await executor.execute(
      plan,
      {
        databaseUrl: `postgresql://setup_proof:${password}@127.0.0.1:${dbPort}/setup_proof`,
        ...(acceptance ? { providerKey: acceptance.providerKey } : {}),
      },
      (step, complete) => {
        if (complete) process.stdout.write(`verified ${step}\n`);
      },
    );
    const headers = {
      authorization: `Bearer ${result.operatorToken}`,
      "content-type": "application/json",
    };
    assert.equal((await fetch(`${result.url}/api/skills`)).status, 401);
    assert.equal((await fetch(result.url)).status, 200);
    const response = await fetch(`${result.url}/api/skills/extensions`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        manifest: {
          schemaVersion: 1,
          id: "user-restart-proof",
          title: "Restart proof",
          description: "Persistent native installation fixture",
          kind: "skill",
          instructions: "Inspect the saved result.",
        },
        enabled: true,
        expectedRevision: 0,
      }),
    });
    assert.equal(response.status, 200);
    const privateDirectory = executor.installationDirectory()!;
    checks.push(
      "real native installation",
      "anonymous API rejected",
      "static UI served",
      "personal capability saved",
    );
    await executor.stopNative();
    const restored = await readInstallation(privateDirectory, source);
    assert.equal(restored.complete, true);
    executor = createInstallationExecutor({
      ...options,
      resume: {
        resources: restored.resources,
        planId: restored.plan.id,
        complete: true,
      },
    });
    const restarted = await executor.execute(
      restored.plan,
      restored.credentials,
      () => {},
    );
    assert.equal(restarted.operatorToken, result.operatorToken);
    const entries = (await (
      await fetch(`${result.url}/api/skills/extensions`, { headers })
    ).json()) as { id: string }[];
    assert.ok(entries.some((entry) => entry.id === "user-restart-proof"));
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(privateDirectory, "installation.json"),
          "utf8",
        ),
      ).phase,
      "complete",
    );
    checks.push("restart preserved operator identity and capability");
    if (acceptance) {
      await acceptance.run({
        baseUrl: result.url,
        operatorToken: result.operatorToken!,
        directory,
      });
      checks.push("live model finite and recurring acceptance");
    }
    await writeFile(
      path.join(directory, "evidence.json"),
      JSON.stringify(
        {
          passed: true,
          platform: process.platform,
          architecture: process.arch,
          checks,
        },
        null,
        2,
      ),
    );
    return directory;
  } finally {
    await executor?.stopNative();
    if (started)
      await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [postgresBin, pnpmPath] = process.argv.slice(2);
  if (!postgresBin || !pnpmPath)
    throw new Error("Supply PostgreSQL bin and pnpm JS paths");
  runNativeInstallSmoke(postgresBin, pnpmPath)
    .then((directory) => process.stdout.write(`Evidence: ${directory}\n`))
    .catch(() => {
      process.stderr.write(
        "Native installation proof failed; inspect its private evidence directory.\n",
      );
      process.exitCode = 1;
    });
}
