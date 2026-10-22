import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdtemp,
  realpath,
  writeFile,
  readFile,
} from "node:fs/promises";
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
import { proveDatabaseBackup } from "./backup-restore-proof";

type NativeProofContext = {
  baseUrl: string;
  operatorToken: string;
  directory: string;
};
export type AdditionalNativeDataProof = {
  prepare: (context: NativeProofContext) => Promise<void>;
  verifyResumed: (context: NativeProofContext) => Promise<void>;
  verifyRestored: (
    readOnlySql: (query: string) => Promise<string>,
  ) => Promise<void>;
};

// Opt-in real native installation proof. Owns a fresh PostgreSQL cluster and
// keeps its evidence directory; it never attaches to the operator's database.
export async function runNativeInstallSmoke(
  postgresBin: string,
  pnpmPath: string,
  acceptance?: (
    { kind?: "live-model"; providerKey: string } | { kind: "offline-guided" }
  ) & {
    run: (context: {
      baseUrl: string;
      operatorToken: string;
      directory: string;
    }) => Promise<void>;
  },
  additionalDataProof?: AdditionalNativeDataProof,
) {
  const source = fileURLToPath(new URL("../../..", import.meta.url));
  // GitHub's artifact collector scans runner.temp, which can differ from the
  // Windows service account's OS temporary directory.
  const directory = await mkdtemp(
    path.join(
      await realpath(process.env.RUNNER_TEMP || tmpdir()),
      "acos-native-install-proof-",
    ),
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
      // pg_ctl may keep inherited handles open; the backup drill needs psql's
      // bounded result instead of discarding every command's output.
      ignoreInheritedStdio: name !== "psql",
    });
  let started = false;
  let executor: ReturnType<typeof createInstallationExecutor> | undefined;
  const checks: string[] = [];
  let stage = "initialize_database";
  const preserveFailure = async (error: unknown) => {
    const protectionReason =
      error instanceof Error &&
      error.cause instanceof Error &&
      /^windows_private_storage_(?:startup_timeout|operation_timeout|spawn_failed|system_root_invalid|postcondition|check_failed|output_limit)$/u.test(
        error.cause.message,
      )
        ? error.cause.message
        : null;
    const failure = {
      schemaVersion: 1,
      passed: false,
      platform: process.platform,
      architecture: process.arch,
      stage,
      errorCode:
        error instanceof Error &&
        error.message === "private_storage_protection_invalid"
          ? "private_storage_protection_invalid"
          : "native_installation_proof_failed",
      protectionReason,
    };
    try {
      await writeFile(
        path.join(directory, "native-installation-failure.json"),
        JSON.stringify(failure, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      // Preserve the original execution failure even if evidence cannot be saved.
    }
    process.stderr.write(
      "Native installation failure: " + JSON.stringify(failure) + "\n",
    );
  };
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
    // Every proof client uses authenticated loopback TCP. Distribution builds
    // can default to a system socket directory unavailable to this owned user.
    await appendFile(
      path.join(data, "postgresql.conf"),
      "\nunix_socket_directories = ''\n",
    );
    stage = "start_database";
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
    stage = "create_database";
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
        provider:
          acceptance && acceptance.kind !== "offline-guided"
            ? "openrouter"
            : "later",
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
        ...(acceptance && "providerKey" in acceptance
          ? { providerKey: acceptance.providerKey }
          : {}),
      },
      (step, complete) => {
        stage = step;
        if (complete) process.stdout.write(`verified ${step}\n`);
      },
    );
    stage = "verify_saved_capability";
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
    if (additionalDataProof) {
      assert.ok(result.operatorToken);
      await additionalDataProof.prepare({
        baseUrl: result.url,
        operatorToken: result.operatorToken,
        directory,
      });
    }
    stage = "verify_restart";
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
    if (additionalDataProof) {
      assert.ok(result.operatorToken);
      await additionalDataProof.verifyResumed({
        baseUrl: result.url,
        operatorToken: result.operatorToken,
        directory,
      });
    }
    stage = "verify_backup_restore";
    const backup = await proveDatabaseBackup({
      database: "setup_proof",
      dumpPath: path.join(directory, "agentic-os.dump"),
      connectionArgs: [
        "-h",
        "127.0.0.1",
        "-p",
        String(dbPort),
        "-U",
        "setup_proof",
      ],
      command,
      ...(additionalDataProof
        ? { verifyAdditionalRestoredData: additionalDataProof.verifyRestored }
        : {}),
    });
    checks.push(
      "binary backup restored roster, migration journal entry count, application writes and sequence state",
    );
    if (additionalDataProof)
      checks.push(
        "additional fixture data persisted through installation resume and binary restore",
      );
    if (acceptance) {
      stage = "additional_acceptance";
      await acceptance.run({
        baseUrl: result.url,
        operatorToken: result.operatorToken!,
        directory,
      });
      checks.push(
        acceptance.kind === "offline-guided"
          ? "offline guided connection with real API, workers and browser acceptance"
          : "live model finite and recurring acceptance",
      );
    }
    stage = "save_evidence";
    await writeFile(
      path.join(directory, "evidence.json"),
      JSON.stringify(
        {
          passed: true,
          platform: process.platform,
          architecture: process.arch,
          backup,
          checks,
        },
        null,
        2,
      ),
    );
    return directory;
  } catch (error) {
    await preserveFailure(error);
    throw error;
  } finally {
    try {
      try {
        await executor?.stopNative();
      } finally {
        if (started)
          await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
      }
    } catch (error) {
      stage = "cleanup";
      await preserveFailure(error);
      throw error;
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [postgresBin, explicitPnpmPath] = process.argv.slice(2);
  const pnpmPath = explicitPnpmPath ?? process.env.npm_execpath;
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
