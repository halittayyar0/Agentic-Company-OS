import { randomBytes, randomUUID } from "node:crypto";
import { lstat, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  executeBoundedCommand,
  ProcessSupervisor,
} from "../endurance/process-supervisor";
import { readBoundedRegularFile } from "./resume";
import {
  assertInstallPortAvailable,
  type InstallationResources,
} from "./resources";

export function validateManagedPostgresPid(
  contents: string,
  pid: number,
  directory: string,
  port: number,
): void {
  const lines = contents.split(/\r?\n/u);
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    lines[0] !== String(pid) ||
    path.resolve(lines[1] ?? "") !== directory ||
    lines[3] !== String(port)
  )
    throw new Error("managed_postgres_process_identity");
}

export async function createManagedDatabaseUrl(): Promise<string> {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("managed_postgres_port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  return `postgresql://agentic:${randomBytes(32).toString("base64url")}@127.0.0.1:${port}/postgres`;
}

export function createManagedPostgres(options: {
  resources: InstallationResources;
  postgresRoot: string;
  planId: string;
  postgresVersion: string;
  run?: typeof executeBoundedCommand;
  signal?: AbortSignal;
}) {
  const run = options.run ?? executeBoundedCommand;
  const directory = options.resources.directory;
  if (
    !path.isAbsolute(directory) ||
    !path.isAbsolute(options.postgresRoot) ||
    !/^17\.\d+$/u.test(options.postgresVersion)
  )
    throw new Error("managed_postgres_configuration");
  const data = path.join(directory, "database");
  const markerFile = path.join(data, "agentic-cluster.json");
  const executable = (name: string) =>
    path.join(
      options.postgresRoot,
      "bin",
      name + (process.platform === "win32" ? ".exe" : ""),
    );
  const supervisor = new ProcessSupervisor({
    runId: `setup-postgres-${options.planId}`,
    logLimitBytes: 64 * 1024,
  });
  let prepared = false,
    started = false;
  let url: URL;
  const command = (name: string, args: string[], timeoutMs = 30_000) =>
    run({
      command: executable(name),
      args,
      cwd: directory,
      environment: { ...process.env, LC_ALL: "C" },
      timeoutMs,
      maxBufferBytes: 128 * 1024,
      ignoreInheritedStdio: false,
      signal: options.signal,
    });
  const readPrivate = (file: string) =>
    readBoundedRegularFile(file, 4096, { rejectSymlinks: true });
  const identity = () => ({
    schemaVersion: 1,
    installationId: options.planId,
    postgresMajor: 17,
    port: Number(url.port),
    database: "postgres",
    username: "agentic",
  });
  const checkIdentity = async () => {
    try {
      if ((await realpath(data)) !== data || !(await lstat(data)).isDirectory())
        throw new Error("redirected cluster");
      const marker = JSON.parse(await readPrivate(markerFile));
      if (
        JSON.stringify(marker) !== JSON.stringify(identity()) ||
        (await readPrivate(path.join(data, "PG_VERSION"))).trim() !== "17"
      )
        throw new Error("foreign cluster");
    } catch {
      throw new Error("managed_postgres_identity");
    }
  };
  const checkProcess = async () => {
    const snapshot = supervisor.snapshot("postgres");
    if (!snapshot?.running || !snapshot.pid)
      throw new Error("managed_postgres_process_identity");
    validateManagedPostgresPid(
      await readPrivate(path.join(data, "postmaster.pid")),
      snapshot.pid,
      data,
      Number(url.port),
    );
  };
  return {
    /** A cold filesystem snapshot requires more than an absent PID file.
     * Caller retains the installation lease for this check and the entire copy.
     * This method never signals a process, starts a server or removes a PID file.
     */
    async inspectStopped(): Promise<{
      dataDirectory: string;
      postgresMajor: 17;
    }> {
      if (!prepared || started)
        throw new Error("managed_postgres_not_prepared");
      options.signal?.throwIfAborted();
      await checkIdentity();
      try {
        await lstat(path.join(data, "postmaster.pid"));
        throw new Error("managed_postgres_shutdown_required");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      for (const name of ["pg_wal", "pg_tblspc"]) {
        const directory = path.join(data, name),
          info = await lstat(directory);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          (await realpath(directory)) !== directory ||
          (name === "pg_tblspc" && (await readdir(directory)).length !== 0)
        )
          throw new Error("managed_postgres_external_storage");
      }
      const control = await command("pg_controldata", ["-D", data], 10_000);
      const states = control.stdout
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("Database cluster state:"))
        .map((line) => line.slice("Database cluster state:".length).trim());
      if (
        control.exitCode !== 0 ||
        states.length !== 1 ||
        states[0] !== "shut down"
      )
        throw new Error("managed_postgres_shutdown_required");
      return { dataDirectory: data, postgresMajor: 17 };
    },
    async prepare() {
      if (process.platform !== "win32" && process.getuid?.() === 0)
        throw new Error("managed_postgres_requires_ordinary_user");
      if ((await realpath(directory)) !== directory)
        throw new Error("managed_postgres_identity");
      url = new URL(
        await readPrivate(options.resources.secretFiles.database_url),
      );
      if (
        url.protocol !== "postgresql:" ||
        url.hostname !== "127.0.0.1" ||
        url.username !== "agentic" ||
        url.pathname !== "/postgres" ||
        !url.password ||
        url.search ||
        url.hash ||
        Number(url.port) < 1024 ||
        Number(url.port) > 65535
      )
        throw new Error("managed_postgres_connection");
      const version = await command("postgres", ["--version"], 10_000);
      if (
        version.stdout.trim() !==
        `postgres (PostgreSQL) ${options.postgresVersion}`
      )
        throw new Error("managed_postgres_version");
      try {
        await lstat(data);
        await checkIdentity();
        prepared = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const passwordFile = path.join(
        directory,
        "secrets",
        "managed_postgres_password",
      );
      const password = decodeURIComponent(url.password);
      try {
        await writeFile(passwordFile, password, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readPrivate(passwordFile)) !== password
        )
          throw new Error("managed_postgres_password_identity");
      }
      const staging = path.join(directory, `database-pending-${randomUUID()}`);
      await command(
        "initdb",
        [
          "--pgdata",
          staging,
          "--username=agentic",
          "--encoding=UTF8",
          "--locale=C",
          "--auth=scram-sha-256",
          "--pwfile",
          passwordFile,
        ],
        60_000,
      );
      if ((await readPrivate(path.join(staging, "PG_VERSION"))).trim() !== "17")
        throw new Error("managed_postgres_version");
      await writeFile(
        path.join(staging, "agentic-cluster.json"),
        JSON.stringify(identity()),
        { flag: "wx", mode: 0o600 },
      );
      // The installer lock owns the parent. A partial init never becomes the
      // live database; the identity moves with the fully initialized cluster.
      await rename(staging, data);
      await checkIdentity();
      prepared = true;
    },
    async start() {
      if (!prepared || started)
        throw new Error("managed_postgres_not_prepared");
      await checkIdentity();
      await assertInstallPortAvailable(Number(url.port));
      supervisor.start({
        name: "postgres",
        command: executable("postgres"),
        args: [
          "-D",
          data,
          "-h",
          "127.0.0.1",
          "-p",
          url.port,
          "-c",
          "unix_socket_directories=",
          "-c",
          "max_connections=50",
          "-c",
          "shared_buffers=64MB",
        ],
        cwd: directory,
        env: { ...process.env, LC_ALL: "C" },
      });
      started = true;
      const deadline = Date.now() + 30_000;
      while (true) {
        options.signal?.throwIfAborted();
        try {
          await command(
            "pg_isready",
            [
              "-h",
              "127.0.0.1",
              "-p",
              url.port,
              "-U",
              "agentic",
              "-d",
              "postgres",
              "-t",
              "1",
            ],
            2000,
          );
          await checkProcess();
          return;
        } catch {
          if (Date.now() >= deadline)
            throw new Error("managed_postgres_readiness");
        }
        await delay(100, undefined, { signal: options.signal });
      }
    },
    async stop() {
      if (!started) return;
      try {
        await checkIdentity();
        await checkProcess();
        // Explicit fast shutdown checkpoints durable data before the exact
        // process-tree fallback. No other database service is selected.
        await executeBoundedCommand({
          command: executable("pg_ctl"),
          args: ["stop", "-D", data, "-m", "fast", "-w", "-t", "15"],
          cwd: directory,
          environment: { ...process.env, LC_ALL: "C" },
          timeoutMs: 20_000,
          maxBufferBytes: 64 * 1024,
          ignoreInheritedStdio: false,
        });
      } finally {
        await supervisor.stopAll();
        started = false;
      }
    },
  };
}
