import path from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";

import {
  DockerWallClockDriver,
  type DockerWallClockDriverOptions,
  type DockerWallClockHarness,
} from "./docker-wall-clock-driver";
import type { FaultScheduleProfile, InjectedFaultKind } from "./fault-injector";
import {
  NativePostgresEnduranceHarness,
  createNativeRuntimeSecrets,
  reserveLoopbackPorts,
  type NativePostgresEnduranceHarnessOptions,
} from "./native-postgres-harness";
import type { SoakEvidenceObserver } from "./soak-observer";
import type {
  WallClockCaptureContext,
  WallClockRuntimeDriver,
} from "./run-wall-clock-soak";

export interface NativeWallClockDriverOptions {
  runId: string;
  seed: number;
  durationHours: number;
  faultProfile?: FaultScheduleProfile;
  workspaceRoot: string;
  postgresRoot: string;
  runDirectory: string;
  operatorToken?: string;
  runtimeControlKey?: string;
  topologyTimeoutMs?: number;
  requestTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  browserSessionFactory?: DockerWallClockDriverOptions["browserSessionFactory"];
  sleep?: DockerWallClockDriverOptions["sleep"];
  now?: () => Date;
  reservePorts?: () => Promise<readonly [number, number]>;
  harnessFactory?: (
    options: NativePostgresEnduranceHarnessOptions,
  ) => DockerWallClockHarness;
  innerDriverFactory?: (
    options: DockerWallClockDriverOptions,
  ) => WallClockRuntimeDriver;
}

export interface NativeWallClockDiagnostics {
  runDirectory: string;
  baseUrl: string | null;
  apiPort: number | null;
  databasePort: number | null;
  harness: ReturnType<NativePostgresEnduranceHarness["diagnostics"]> | null;
}

async function defaultReservePorts(): Promise<readonly [number, number]> {
  const ports = await reserveLoopbackPorts(2);
  return [ports[0], ports[1]];
}

function requireSafeRunId(runId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(runId)) {
    throw new TypeError(
      "runId must use lowercase letters, digits, and hyphens with no path segments",
    );
  }
}

export class NativeWallClockDriver implements WallClockRuntimeDriver {
  private readonly options: NativeWallClockDriverOptions;
  private readonly operatorToken: string;
  private readonly runtimeControlKey: string;
  private readonly reservePorts: NonNullable<
    NativeWallClockDriverOptions["reservePorts"]
  >;
  private readonly harnessFactory: NonNullable<
    NativeWallClockDriverOptions["harnessFactory"]
  >;
  private readonly innerDriverFactory: NonNullable<
    NativeWallClockDriverOptions["innerDriverFactory"]
  >;
  private readonly nowImpl: () => Date;

  private inner: WallClockRuntimeDriver | null = null;
  private harness: DockerWallClockHarness | null = null;
  private nativeHarness: NativePostgresEnduranceHarness | null = null;
  private apiPort: number | null = null;
  private databasePort: number | null = null;
  private baseUrl: string | null = null;
  private started = false;

  constructor(options: NativeWallClockDriverOptions) {
    requireSafeRunId(options.runId);
    if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
      throw new TypeError("seed must be a non-negative safe integer");
    }
    if (
      !Number.isFinite(options.durationHours) ||
      options.durationHours < 1 / 60
    ) {
      throw new TypeError("durationHours must be at least one minute");
    }
    const generated = createNativeRuntimeSecrets();
    this.operatorToken = options.operatorToken ?? generated.operatorToken;
    this.runtimeControlKey =
      options.runtimeControlKey ?? generated.runtimeControlKey;
    this.options = {
      ...options,
      workspaceRoot: path.resolve(options.workspaceRoot),
      postgresRoot: path.resolve(options.postgresRoot),
      runDirectory: path.resolve(options.runDirectory),
    };
    this.reservePorts = options.reservePorts ?? defaultReservePorts;
    this.harnessFactory =
      options.harnessFactory ??
      ((harnessOptions) => {
        const harness = new NativePostgresEnduranceHarness(harnessOptions);
        this.nativeHarness = harness;
        return harness;
      });
    this.innerDriverFactory =
      options.innerDriverFactory ??
      ((driverOptions) => new DockerWallClockDriver(driverOptions));
    this.nowImpl = options.now ?? (() => new Date());
  }

  private requireInner(): WallClockRuntimeDriver {
    if (!this.inner) throw new Error("Native wall-clock driver is not started");
    return this.inner;
  }

  async start(): Promise<{
    projectId: number;
    expectedResponsibilities: number;
  }> {
    if (this.started || this.inner) {
      throw new Error("Native wall-clock driver is already started");
    }
    this.started = true;
    await mkdir(this.options.runDirectory, { recursive: true });
    const runDirectoryMetadata = await lstat(this.options.runDirectory);
    if (
      !runDirectoryMetadata.isDirectory() ||
      runDirectoryMetadata.isSymbolicLink() ||
      path.resolve(await realpath(this.options.runDirectory)) !==
        path.resolve(this.options.runDirectory)
    ) {
      throw new Error(
        "Native control directory must be an exact real local directory",
      );
    }
    const [apiPort, databasePort] = await this.reservePorts();
    if (apiPort === databasePort) {
      throw new Error("Native runtime port allocator returned duplicate ports");
    }
    this.apiPort = apiPort;
    this.databasePort = databasePort;
    this.baseUrl = `http://127.0.0.1:${apiPort}/`;
    this.harness = this.harnessFactory({
      runId: this.options.runId,
      workspaceRoot: this.options.workspaceRoot,
      postgresRoot: this.options.postgresRoot,
      runDirectory: this.options.runDirectory,
      apiPort,
      databasePort,
      operatorToken: this.operatorToken,
      runtimeControlKey: this.runtimeControlKey,
      seed: this.options.seed,
      expectedAgents: 10,
      startupTimeoutMs: this.options.topologyTimeoutMs,
      environment: this.options.environment,
    });
    this.inner = this.innerDriverFactory({
      runId: this.options.runId,
      seed: this.options.seed,
      durationHours: this.options.durationHours,
      faultProfile: this.options.faultProfile,
      workspaceRoot: this.options.workspaceRoot,
      controlDirectory: this.options.runDirectory,
      baseUrl: this.baseUrl,
      operatorToken: this.operatorToken,
      harness: this.harness,
      fetchImpl: this.options.fetchImpl,
      topologyTimeoutMs: this.options.topologyTimeoutMs,
      requestTimeoutMs: this.options.requestTimeoutMs,
      browserSessionFactory: this.options.browserSessionFactory,
      sleep: this.options.sleep,
      now: this.nowImpl,
      environment: this.options.environment,
    });
    return this.inner.start();
  }

  captureEvidence(
    observer: SoakEvidenceObserver,
    context: WallClockCaptureContext,
  ): Promise<void> {
    return this.requireInner().captureEvidence(observer, context);
  }

  createBrowserSession() {
    return this.requireInner().createBrowserSession();
  }

  async provenance() {
    const provenance = await this.requireInner().provenance();
    return {
      ...provenance,
      configuration: {
        ...provenance.configuration,
        runtime: "native-postgres",
      },
    };
  }

  stop(options: { keepData: boolean }): Promise<void> {
    return this.inner ? this.inner.stop(options) : Promise.resolve();
  }

  now(): Date {
    return this.inner?.now() ?? this.nowImpl();
  }

  listActiveWorkers() {
    return this.requireInner().listActiveWorkers();
  }

  killWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    return this.requireInner().killWorker(worker);
  }

  restartWorker(worker: "worker-1" | "worker-2"): Promise<void> {
    return this.requireInner().restartWorker(worker);
  }

  setProviderFault(kind: InjectedFaultKind, faultId: string): Promise<void> {
    return this.requireInner().setProviderFault(kind, faultId);
  }

  clearProviderFault(faultId: string): Promise<void> {
    return this.requireInner().clearProviderFault(faultId);
  }

  pauseDatabase(): Promise<void> {
    return this.requireInner().pauseDatabase();
  }

  resumeDatabase(): Promise<void> {
    return this.requireInner().resumeDatabase();
  }

  disconnectObserverStream(): Promise<void> {
    return this.requireInner().disconnectObserverStream();
  }

  reconnectObserverStream(): Promise<void> {
    return this.requireInner().reconnectObserverStream();
  }

  enableEmergencyStop(): Promise<void> {
    return this.requireInner().enableEmergencyStop();
  }

  disableEmergencyStop(): Promise<void> {
    return this.requireInner().disableEmergencyStop();
  }

  sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return this.requireInner().sleep(milliseconds, signal);
  }

  diagnostics(): NativeWallClockDiagnostics {
    return {
      runDirectory: this.options.runDirectory,
      baseUrl: this.baseUrl,
      apiPort: this.apiPort,
      databasePort: this.databasePort,
      harness: this.nativeHarness?.diagnostics() ?? null,
    };
  }

  nativeServices(): Promise<string[]> {
    if (!this.harness) {
      return Promise.reject(
        new Error("Native wall-clock driver is not started"),
      );
    }
    return this.harness.listRunningServices();
  }

  nativePostgresVersion(): Promise<string> {
    if (!this.harness) {
      return Promise.reject(
        new Error("Native wall-clock driver is not started"),
      );
    }
    return this.harness.postgresVersion();
  }
}
