import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";

export interface BrowserSemanticSample {
  runtimeLabel: string;
  incidentVisible: boolean;
  reconnectCursorAdvanced: boolean;
  pageErrors: string[];
  mismatch?: string;
}

export interface BrowserEvidenceSample extends BrowserSemanticSample {
  index: number;
  capturedAt: string;
}

export interface BrowserMonitorSession {
  browserVersion?: string;
  setOffline?(offline: boolean): Promise<void>;
  sample(): Promise<BrowserSemanticSample>;
  screenshot(target: string): Promise<void>;
  close(): Promise<void>;
  forceClose?(): Promise<void>;
}

export interface BrowserCheckpoint {
  kind: "start" | "mismatch" | "end";
  path: string;
  sha256: string;
  capturedAt: string;
}

export interface BrowserMonitorResult {
  pass: boolean;
  restarts: number;
  samples: BrowserEvidenceSample[];
  checkpoints: BrowserCheckpoint[];
  errors: string[];
  startCheckpointSha256: string;
  endCheckpointSha256: string;
  incidentCorrelations: number;
  sseReconnectEventIdAdvanced: boolean;
}

export interface BrowserMonitorOptions {
  runId: string;
  outputDirectory: string;
  sampleCount: number;
  sampleIntervalMs: number;
  maxRestarts?: number;
  maxScreenshots?: number;
  maxLogBytes?: number;
  operationTimeoutMs?: number;
  maxRestartElapsedMs?: number;
  createSession(
    signal: AbortSignal,
    cleanupTimeoutMs: number,
  ): Promise<BrowserMonitorSession>;
  sleep(milliseconds: number): Promise<void>;
  now(): Date;
  signal?: AbortSignal;
}

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        if (signal) {
          abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export interface BrowserSessionDisposalResult {
  forced: boolean;
  gracefulError: string | null;
}

export async function disposeBrowserMonitorSession(
  session: BrowserMonitorSession,
  timeoutMs: number,
  label = "Browser close",
): Promise<BrowserSessionDisposalResult> {
  try {
    await withDeadline(session.close(), timeoutMs, label);
    return { forced: false, gracefulError: null };
  } catch (gracefulError) {
    if (!session.forceClose) throw gracefulError;
    const forceErrors: unknown[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await withDeadline(
          session.forceClose(),
          timeoutMs,
          `${label} force close attempt ${attempt}`,
        );
        return {
          forced: true,
          gracefulError:
            gracefulError instanceof Error
              ? gracefulError.message
              : String(gracefulError),
        };
      } catch (forceError) {
        forceErrors.push(forceError);
      }
    }
    throw new AggregateError(
      [gracefulError, ...forceErrors],
      `${label} and force close both failed`,
    );
  }
}

function boundedText(value: string, maxBytes = 500): string {
  const bytes = Buffer.from(value, "utf8");
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

async function metadataIfPresent(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function requireExactCheckpointDirectory(
  directory: string,
): Promise<string> {
  const resolved = path.resolve(directory);
  let metadata = await metadataIfPresent(resolved);
  if (!metadata) {
    const parent = path.dirname(resolved);
    const parentMetadata = await metadataIfPresent(parent);
    if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new Error("Browser checkpoint parent must be a real directory");
    }
    const actualParent = await realpath(parent);
    if (pathIdentity(actualParent) !== pathIdentity(parent)) {
      throw new Error("Browser checkpoint parent directory was redirected");
    }
    try {
      await mkdir(resolved, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
    metadata = await metadataIfPresent(resolved);
  }
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Browser checkpoint directory must be a real directory");
  }
  const actual = await realpath(resolved);
  if (pathIdentity(actual) !== pathIdentity(resolved)) {
    throw new Error("Browser checkpoint directory was redirected");
  }
  return actual;
}

export async function runBrowserMonitor(
  options: BrowserMonitorOptions,
): Promise<BrowserMonitorResult> {
  if (!SAFE_RUN_ID.test(options.runId)) {
    throw new TypeError("browser monitor runId is invalid");
  }
  if (!Number.isSafeInteger(options.sampleCount) || options.sampleCount < 1) {
    throw new TypeError("sampleCount must be a positive integer");
  }
  if (
    !Number.isFinite(options.sampleIntervalMs) ||
    options.sampleIntervalMs < 0
  ) {
    throw new TypeError("sampleIntervalMs must be non-negative");
  }
  const maxRestarts = options.maxRestarts ?? 3;
  const maxScreenshots = options.maxScreenshots ?? 100;
  const maxLogBytes = options.maxLogBytes ?? 100 * 1024 * 1024;
  const operationTimeoutMs = options.operationTimeoutMs ?? 30_000;
  const maxRestartElapsedMs = options.maxRestartElapsedMs ?? 120_000;
  if (!Number.isSafeInteger(maxRestarts) || maxRestarts < 0) {
    throw new TypeError("maxRestarts must be a non-negative integer");
  }
  if (!Number.isSafeInteger(maxScreenshots) || maxScreenshots < 2) {
    throw new TypeError("maxScreenshots must allow start and end checkpoints");
  }
  for (const [label, value] of [
    ["operationTimeoutMs", operationTimeoutMs],
    ["maxRestartElapsedMs", maxRestartElapsedMs],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${label} must be positive`);
    }
  }
  const outputDirectory = await requireExactCheckpointDirectory(
    options.outputDirectory,
  );

  let active: BrowserMonitorSession | null = null;
  let restarts = 0;
  let restartElapsedMs = 0;
  let loggedBytes = 0;
  const samples: BrowserEvidenceSample[] = [];
  const checkpoints: BrowserCheckpoint[] = [];
  const errors: string[] = [];
  const appendError = (value: string) => {
    const bounded = boundedText(value);
    const bytes = Buffer.byteLength(bounded, "utf8");
    if (loggedBytes + bytes > maxLogBytes) return;
    loggedBytes += bytes;
    errors.push(bounded);
  };
  const closeActive = async () => {
    const current = active;
    if (current) {
      const disposal = await disposeBrowserMonitorSession(
        current,
        operationTimeoutMs,
        "Browser close",
      );
      if (disposal.gracefulError) appendError(disposal.gracefulError);
      if (active === current) active = null;
    }
  };
  const createActive = async () => {
    const creationController = new AbortController();
    const abortCreation = () =>
      creationController.abort(options.signal?.reason);
    if (options.signal?.aborted) abortCreation();
    else
      options.signal?.addEventListener("abort", abortCreation, { once: true });
    const creation = Promise.resolve().then(() =>
      options.createSession(creationController.signal, operationTimeoutMs),
    );
    try {
      active = await withDeadline(
        creation,
        operationTimeoutMs,
        "Browser session creation",
        options.signal,
      );
    } catch (error) {
      creationController.abort(error);
      void creation.then(
        async (lateSession) => {
          try {
            const disposal = await disposeBrowserMonitorSession(
              lateSession,
              operationTimeoutMs,
              "Late browser session close",
            );
            if (disposal.gracefulError) appendError(disposal.gracefulError);
          } catch (cleanupError) {
            appendError(
              `Late browser session cleanup failed: ${
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError)
              }`,
            );
          }
        },
        () => undefined,
      );
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abortCreation);
    }
  };
  const capture = async (kind: BrowserCheckpoint["kind"]) => {
    if (!active) throw new Error("Browser monitor has no active session");
    const index = checkpoints.length.toString().padStart(3, "0");
    await requireExactCheckpointDirectory(outputDirectory);
    const target = path.join(
      outputDirectory,
      `${options.runId}-${index}-${kind}.png`,
    );
    if (await metadataIfPresent(target)) {
      throw new Error(`Browser checkpoint already exists: ${target}`);
    }
    const temporaryTarget = path.join(
      outputDirectory,
      `.${path.basename(target, ".png")}.${randomUUID()}.tmp.png`,
    );
    try {
      await withDeadline(
        active.screenshot(temporaryTarget),
        operationTimeoutMs,
        "Browser screenshot",
        options.signal,
      );
      await requireExactCheckpointDirectory(outputDirectory);
      const temporaryMetadata = await metadataIfPresent(temporaryTarget);
      if (!temporaryMetadata?.isFile() || temporaryMetadata.isSymbolicLink()) {
        throw new Error(
          "Browser checkpoint capture did not produce a regular file",
        );
      }
      const actualTemporaryTarget = await realpath(temporaryTarget);
      if (
        pathIdentity(actualTemporaryTarget) !== pathIdentity(temporaryTarget)
      ) {
        throw new Error("Browser checkpoint capture was redirected");
      }
      const bytes = await readFile(actualTemporaryTarget);
      try {
        await link(actualTemporaryTarget, target);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          throw new Error(`Browser checkpoint already exists: ${target}`);
        }
        throw error;
      }
      const targetMetadata = await lstat(target);
      const actualTarget = await realpath(target);
      if (
        !targetMetadata.isFile() ||
        targetMetadata.isSymbolicLink() ||
        pathIdentity(actualTarget) !== pathIdentity(target)
      ) {
        throw new Error("Browser checkpoint publication was redirected");
      }
      checkpoints.push({
        kind,
        path: target,
        sha256: sha256(bytes),
        capturedAt: options.now().toISOString(),
      });
    } finally {
      await rm(temporaryTarget, { force: true });
    }
  };

  try {
    options.signal?.throwIfAborted();
    await createActive();
    await capture("start");
    let sampleIndex = 0;
    while (sampleIndex < options.sampleCount) {
      try {
        options.signal?.throwIfAborted();
        const current = active as BrowserMonitorSession | null;
        if (!current) throw new Error("Browser monitor session is unavailable");
        const sample = await withDeadline(
          current.sample(),
          operationTimeoutMs,
          "Browser sample",
          options.signal,
        );
        const sanitized: BrowserEvidenceSample = {
          index: sampleIndex,
          capturedAt: options.now().toISOString(),
          runtimeLabel: boundedText(sample.runtimeLabel),
          incidentVisible: sample.incidentVisible,
          reconnectCursorAdvanced: sample.reconnectCursorAdvanced,
          pageErrors: sample.pageErrors.map((error) => boundedText(error)),
          ...(sample.mismatch
            ? { mismatch: boundedText(sample.mismatch) }
            : {}),
        };
        samples.push(sanitized);
        for (const error of sanitized.pageErrors) appendError(error);
        if (sanitized.mismatch) {
          appendError(sanitized.mismatch);
          if (checkpoints.length < maxScreenshots - 1) {
            await capture("mismatch");
          }
        }
        sampleIndex += 1;
        if (sampleIndex < options.sampleCount) {
          await withDeadline(
            options.sleep(options.sampleIntervalMs),
            options.sampleIntervalMs + operationTimeoutMs,
            "Browser sample interval",
            options.signal,
          );
          options.signal?.throwIfAborted();
        }
      } catch (error) {
        const restartStartedAt = Date.now();
        appendError(error instanceof Error ? error.message : String(error));
        await closeActive();
        if (restarts >= maxRestarts) {
          throw new Error("Browser monitor exhausted its restart budget");
        }
        const backoffMs = Math.min(30_000, 1_000 * 2 ** restarts);
        restarts += 1;
        const remainingRestartMs = maxRestartElapsedMs - restartElapsedMs;
        if (remainingRestartMs <= 0) {
          throw new Error("Browser monitor exhausted its restart time budget");
        }
        await withDeadline(
          options.sleep(backoffMs),
          Math.min(remainingRestartMs, backoffMs + operationTimeoutMs),
          "Browser restart backoff",
          options.signal,
        );
        options.signal?.throwIfAborted();
        await createActive();
        restartElapsedMs += Date.now() - restartStartedAt;
        if (restartElapsedMs > maxRestartElapsedMs) {
          throw new Error("Browser monitor exhausted its restart time budget");
        }
      }
    }
    await capture("end");
  } finally {
    await closeActive();
  }

  const start = checkpoints.find((item) => item.kind === "start");
  const end = checkpoints.filter((item) => item.kind === "end").at(-1);
  if (!start || !end)
    throw new Error("Browser monitor checkpoint evidence is incomplete");
  return {
    pass:
      samples.length === options.sampleCount &&
      samples.every(
        (sample) => !sample.mismatch && sample.pageErrors.length === 0,
      ),
    restarts,
    samples,
    checkpoints,
    errors,
    startCheckpointSha256: start.sha256,
    endCheckpointSha256: end.sha256,
    incidentCorrelations: samples.filter((sample) => sample.incidentVisible)
      .length,
    sseReconnectEventIdAdvanced: samples.some(
      (sample) => sample.reconnectCursorAdvanced,
    ),
  };
}

function loopbackBaseUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
  ) {
    throw new TypeError("Playwright endurance monitoring is loopback-only");
  }
  return url;
}

export function operationsTextHasIncident(value: string): boolean {
  const text = value.toLocaleLowerCase("tr-TR");
  return (
    /\b[1-9][0-9]*\s+(?:olay|incident)\b/iu.test(text) ||
    /\b(?:kurtar(?:ma|ıldı|ildi|ıldı|ildi)?|recovery|recovered)\b/iu.test(text)
  );
}

export function operationsNavigationWaitUntil(): "domcontentloaded" {
  return "domcontentloaded";
}

interface PlaywrightLocatorAdapter {
  first(): PlaywrightLocatorAdapter;
  getAttribute(name: string): Promise<string | null>;
  innerText(): Promise<string>;
  textContent(): Promise<string | null>;
  waitFor(): Promise<void>;
}

interface PlaywrightPageAdapter {
  on(
    event: "console",
    listener: (message: {
      type(): string;
      text(): string;
      location?(): { url: string };
    }) => void,
  ): unknown;
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  getByText(
    text: string | RegExp,
    options?: { exact?: boolean },
  ): PlaywrightLocatorAdapter;
  locator(selector: string): PlaywrightLocatorAdapter;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded" },
  ): Promise<unknown>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  waitForTimeout(milliseconds: number): Promise<void>;
}

interface PlaywrightContextAdapter {
  close(): Promise<void>;
  newPage(): Promise<PlaywrightPageAdapter>;
  setOffline(offline: boolean): Promise<void>;
}

interface PlaywrightBrowserAdapter {
  close(): Promise<void>;
  newContext(options: {
    extraHTTPHeaders: Record<string, string>;
    locale: string;
    storageState: {
      cookies: never[];
      origins: {
        origin: string;
        localStorage: { name: string; value: string }[];
      }[];
    };
  }): Promise<PlaywrightContextAdapter>;
  version(): string;
}

interface PlaywrightBrowserServerAdapter {
  close(): Promise<void>;
  kill(): Promise<void>;
  wsEndpoint(): string;
}

interface PlaywrightChromiumAdapter {
  connect(endpoint: string): Promise<PlaywrightBrowserAdapter>;
  launchServer(options: {
    headless: boolean;
  }): Promise<PlaywrightBrowserServerAdapter>;
}

export interface PlaywrightOperationsSessionDependencies {
  loadChromium?(): Promise<unknown>;
}

function beginBestEffortCleanup(operation: () => Promise<void>): void {
  try {
    void operation().catch(() => undefined);
  } catch {
    // A synchronous close failure does not supersede the force-kill path.
  }
}

export async function createPlaywrightOperationsSession(
  input: {
    baseUrl: string;
    projectId: number;
    operatorToken: string;
    signal?: AbortSignal;
    cleanupTimeoutMs?: number;
    isExpectedDatabaseOutage?: () => boolean;
  },
  dependencies: PlaywrightOperationsSessionDependencies = {},
): Promise<BrowserMonitorSession> {
  const baseUrl = loopbackBaseUrl(input.baseUrl);
  if (!Number.isSafeInteger(input.projectId) || input.projectId < 1) {
    throw new TypeError("projectId must be a positive integer");
  }
  if (!input.operatorToken.trim())
    throw new TypeError("operatorToken is required");
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? 30_000;
  if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0) {
    throw new TypeError("cleanupTimeoutMs must be positive");
  }
  input.signal?.throwIfAborted();
  const chromium = (
    dependencies.loadChromium
      ? await dependencies.loadChromium()
      : (await import("@playwright/test")).chromium
  ) as PlaywrightChromiumAdapter;
  input.signal?.throwIfAborted();
  const browserServer = await chromium.launchServer({ headless: true });
  let forceKillPromise: Promise<void> | null = null;
  const forceKill = () => {
    if (!forceKillPromise) {
      const attempt = browserServer.kill();
      forceKillPromise = attempt;
      void attempt.catch(() => {
        if (forceKillPromise === attempt) forceKillPromise = null;
      });
    }
    return forceKillPromise;
  };
  const abortSetup = () => {
    void forceKill().catch(() => undefined);
  };
  const forceKillWithDeadline = () =>
    withDeadline(
      forceKill(),
      cleanupTimeoutMs,
      "Playwright browser server kill",
    );
  if (input.signal?.aborted) abortSetup();
  else input.signal?.addEventListener("abort", abortSetup, { once: true });

  let browser: PlaywrightBrowserAdapter | null = null;
  let context: PlaywrightContextAdapter | null = null;
  try {
    input.signal?.throwIfAborted();
    browser = await chromium.connect(browserServer.wsEndpoint());
    input.signal?.throwIfAborted();
    context = await browser.newContext({
      extraHTTPHeaders: { authorization: `Bearer ${input.operatorToken}` },
      // This observer verifies the Operations screen after first-run language
      // selection. Keep its semantic selectors stable without changing the
      // operator's saved language or bypassing the separate onboarding tests.
      locale: "tr-TR",
      storageState: {
        cookies: [],
        origins: [
          {
            origin: new URL(baseUrl).origin,
            localStorage: [{ name: "acos.locale.v1", value: "tr" }],
          },
        ],
      },
    });
    input.signal?.throwIfAborted();
  } catch (error) {
    input.signal?.removeEventListener("abort", abortSetup);
    const failedContext = context;
    const failedBrowser = browser;
    if (failedContext) beginBestEffortCleanup(() => failedContext.close());
    if (failedBrowser) beginBestEffortCleanup(() => failedBrowser.close());
    try {
      await forceKillWithDeadline();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Playwright setup and force cleanup failed",
      );
    }
    throw error;
  }

  let page: PlaywrightPageAdapter;
  try {
    page = await context.newPage();
    input.signal?.throwIfAborted();
  } catch (error) {
    input.signal?.removeEventListener("abort", abortSetup);
    beginBestEffortCleanup(() => context.close());
    beginBestEffortCleanup(() => browser.close());
    try {
      await forceKillWithDeadline();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Playwright page setup and force cleanup failed",
      );
    }
    throw error;
  }
  const pageErrors: string[] = [];
  let intentionalOffline = false;
  let browserVersion: string;
  try {
    page.on("console", (message) => {
      if (message.type() === "error" && !intentionalOffline) {
        // An injected database outage intentionally makes these read requests
        // fail. Keep JavaScript errors, other endpoints/origins, and errors
        // outside the driver's bounded outage window as failures.
        if (
          input.isExpectedDatabaseOutage?.() &&
          /^Failed to load resource: the server responded with a status of (500 \(Internal Server Error\)|503 \(Service Unavailable\))$/u.test(
            message.text(),
          )
        ) {
          try {
            const location = new URL(message.location?.().url ?? "");
            if (
              location.origin === baseUrl.origin &&
              [
                `/api/tasks/${input.projectId}/operations`,
                "/api/ops/control",
                "/api/org/summary",
              ].includes(location.pathname)
            )
              return;
          } catch {
            /* Missing resource identity is never an expected error. */
          }
        }
        pageErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (!intentionalOffline) pageErrors.push(error.message);
    });
    await page.goto(
      new URL(`/projects/${input.projectId}/operations`, baseUrl).href,
      {
        waitUntil: operationsNavigationWaitUntil(),
      },
    );
    input.signal?.throwIfAborted();
    await page.getByText("Operasyon odası", { exact: true }).waitFor();
    input.signal?.throwIfAborted();
    browserVersion = browser.version();
  } catch (error) {
    input.signal?.removeEventListener("abort", abortSetup);
    beginBestEffortCleanup(() => context.close());
    beginBestEffortCleanup(() => browser.close());
    try {
      await forceKillWithDeadline();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Playwright navigation setup and force cleanup failed",
      );
    }
    throw error;
  }
  input.signal?.removeEventListener("abort", abortSetup);
  let disconnectedCursor: bigint | null = null;
  let cursorAdvanced = false;
  const readVisibleCursor = async (): Promise<bigint | null> => {
    const cursorText = await page
      .locator("[data-operations-cursor]")
      .first()
      .getAttribute("data-operations-cursor")
      .catch(() => null);
    return cursorText && /^\d+$/.test(cursorText) ? BigInt(cursorText) : null;
  };

  let gracefullyClosed = false;
  const closeGracefully = async () => {
    if (gracefullyClosed) return;
    if (forceKillPromise) {
      await forceKillPromise;
      gracefullyClosed = true;
      return;
    }
    await context.close();
    await browser.close();
    await browserServer.close();
    gracefullyClosed = true;
  };
  const closeForcibly = async () => {
    if (gracefullyClosed) return;
    try {
      await forceKill();
    } finally {
      beginBestEffortCleanup(() => context.close());
      beginBestEffortCleanup(() => browser.close());
    }
    gracefullyClosed = true;
  };

  return {
    browserVersion,
    setOffline: async (offline) => {
      if (offline) {
        disconnectedCursor = await readVisibleCursor();
        intentionalOffline = true;
        await context.setOffline(true);
        return;
      }
      await context.setOffline(false);
      intentionalOffline = false;
      if (disconnectedCursor === null) return;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const badge = page.locator('[role="status"][data-runtime]').first();
        const [transport, cursor] = await Promise.all([
          badge.getAttribute("data-transport"),
          readVisibleCursor(),
        ]);
        if (
          transport === "live" &&
          cursor !== null &&
          cursor > disconnectedCursor
        ) {
          cursorAdvanced = true;
          return;
        }
        await page.waitForTimeout(250);
      }
    },
    sample: async () => {
      const badge = page.locator('[role="status"][data-runtime]').first();
      const runtimeLabel =
        (await badge.getAttribute("aria-label")) ?? "unknown";
      const transport = await badge.getAttribute("data-transport");
      const cursor = await readVisibleCursor();
      if (transport === "disconnected" && cursor !== null) {
        disconnectedCursor = cursor;
      }
      if (
        disconnectedCursor !== null &&
        transport === "live" &&
        cursor !== null &&
        cursor > disconnectedCursor
      ) {
        cursorAdvanced = true;
      }
      const bodyText = (
        await page.locator("main").innerText()
      ).toLocaleLowerCase("tr-TR");
      const capturedErrors = pageErrors.splice(0, pageErrors.length);
      return {
        runtimeLabel,
        incidentVisible: operationsTextHasIncident(bodyText),
        reconnectCursorAdvanced: cursorAdvanced,
        pageErrors: capturedErrors,
        ...(runtimeLabel.toLocaleLowerCase("tr-TR").includes("canlı") &&
        transport !== "live"
          ? {
              mismatch:
                "Runtime label claimed live while transport was not live",
            }
          : {}),
      };
    },
    screenshot: async (target) => {
      await page.screenshot({ path: target, fullPage: true });
    },
    close: closeGracefully,
    forceClose: closeForcibly,
  };
}
