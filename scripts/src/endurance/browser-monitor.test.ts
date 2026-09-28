import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPlaywrightOperationsSession,
  operationsNavigationWaitUntil,
  operationsTextHasIncident,
  runBrowserMonitor,
  type BrowserMonitorSession,
} from "./browser-monitor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for browser lifecycle assertion");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

test("Operations navigation does not wait for persistent SSE to become idle", () => {
  assert.equal(operationsNavigationWaitUntil(), "domcontentloaded");
});

test("operations incident semantics do not treat zero-event copy as evidence", () => {
  assert.equal(operationsTextHasIncident("0 olay · sistem canlı"), false);
  assert.equal(operationsTextHasIncident("0 incident · live"), false);
  assert.equal(operationsTextHasIncident("1 olay kurtarıldı"), true);
  assert.equal(operationsTextHasIncident("Kritik kurtarma kaydı"), true);
});

function session(input: {
  name: string;
  failSample?: number;
  log: string[];
}): BrowserMonitorSession {
  let samples = 0;
  return {
    sample: async () => {
      samples += 1;
      input.log.push(`${input.name}:sample:${samples}`);
      if (samples === input.failSample) throw new Error("chromium exited");
      return {
        runtimeLabel: samples === 2 ? "Bağlantı koptu" : "Canlı",
        incidentVisible: samples >= 2,
        reconnectCursorAdvanced: samples >= 3,
        pageErrors: [],
      };
    },
    screenshot: async (target) => {
      input.log.push(`${input.name}:screenshot:${path.basename(target)}`);
      await writeFile(target, `png:${input.name}:${samples}`, "utf8");
    },
    close: async () => {
      input.log.push(`${input.name}:close`);
    },
  };
}

test("monitor restarts Chromium with backoff and preserves start/end evidence", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  const log: string[] = [];
  let creations = 0;
  try {
    const result = await runBrowserMonitor({
      runId: "browser-test",
      outputDirectory: directory,
      sampleCount: 4,
      sampleIntervalMs: 60_000,
      maxRestarts: 3,
      createSession: async () => {
        creations += 1;
        return session({
          name: `session-${creations}`,
          failSample: creations === 1 ? 3 : undefined,
          log,
        });
      },
      sleep: async (milliseconds) => {
        log.push(`sleep:${milliseconds}`);
      },
      now: (() => {
        let tick = 0;
        return () => new Date(Date.UTC(2026, 8, 1, 0, tick++));
      })(),
    });

    assert.equal(result.restarts, 1);
    assert.equal(result.samples.length, 4);
    assert.deepEqual(
      result.samples.map((sample) => sample.index),
      [0, 1, 2, 3],
    );
    assert.equal(
      result.samples.every(
        (sample) =>
          new Date(sample.capturedAt).toISOString() === sample.capturedAt,
      ),
      true,
    );
    assert.equal(
      result.checkpoints.some((item) => item.kind === "start"),
      true,
    );
    assert.equal(
      result.checkpoints.some((item) => item.kind === "end"),
      true,
    );
    assert.match(result.startCheckpointSha256, /^[a-f0-9]{64}$/);
    assert.match(result.endCheckpointSha256, /^[a-f0-9]{64}$/);
    assert.equal(log.includes("sleep:1000"), true);
    assert.equal(log.filter((item) => item.endsWith(":close")).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor caps mismatch screenshots and records bounded semantic failures", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  try {
    const fake: BrowserMonitorSession = {
      sample: async () => ({
        runtimeLabel: "Canlı",
        incidentVisible: false,
        reconnectCursorAdvanced: false,
        pageErrors: ["x".repeat(2_000)],
        mismatch: "health truth mismatch",
      }),
      screenshot: async (target) => writeFile(target, "png", "utf8"),
      close: async () => undefined,
    };
    const result = await runBrowserMonitor({
      runId: "cap-test",
      outputDirectory: directory,
      sampleCount: 120,
      sampleIntervalMs: 1,
      maxScreenshots: 100,
      createSession: async () => fake,
      sleep: async () => undefined,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(result.pass, false);
    assert.equal(result.checkpoints.length, 100);
    assert.equal(
      result.errors.every((item) => item.length <= 500),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor fails after the bounded restart budget and still closes sessions", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  let closes = 0;
  try {
    await assert.rejects(
      runBrowserMonitor({
        runId: "restart-limit",
        outputDirectory: directory,
        sampleCount: 1,
        sampleIntervalMs: 1,
        maxRestarts: 1,
        createSession: async () => ({
          sample: async () => {
            throw new Error("browser unavailable");
          },
          screenshot: async (target) => writeFile(target, "png", "utf8"),
          close: async () => {
            closes += 1;
          },
        }),
        sleep: async () => undefined,
        now: () => new Date("2026-09-01T00:00:00.000Z"),
      }),
      /restart budget/,
    );
    assert.equal(closes, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor bounds hung browser operations and restart recovery time", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  let closes = 0;
  try {
    await assert.rejects(
      runBrowserMonitor({
        runId: "hung-sample",
        outputDirectory: directory,
        sampleCount: 1,
        sampleIntervalMs: 1,
        operationTimeoutMs: 10,
        maxRestartElapsedMs: 25,
        maxRestarts: 3,
        createSession: async () => ({
          sample: () => new Promise(() => undefined),
          // The deadline under test is the hung sample. Make checkpoint
          // creation immediate so filesystem scheduling cannot win its 10 ms
          // screenshot deadline during a busy full-suite run.
          screenshot: async (target) => {
            writeFileSync(target, "png", "utf8");
          },
          close: async () => {
            closes += 1;
          },
        }),
        sleep: async () => undefined,
        now: () => new Date("2026-09-01T00:00:00.000Z"),
      }),
      /sample timed out|restart.*budget/iu,
    );
    assert.ok(closes >= 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor force-closes a session that resolves after its creation deadline", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  const creation = deferred<BrowserMonitorSession>();
  const log: string[] = [];
  const creationSignals: AbortSignal[] = [];
  try {
    const monitor = runBrowserMonitor({
      runId: "late-session",
      outputDirectory: directory,
      sampleCount: 1,
      sampleIntervalMs: 1,
      operationTimeoutMs: 10,
      createSession: (signal) => {
        creationSignals.push(signal);
        return creation.promise;
      },
      sleep: async () => undefined,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    await assert.rejects(monitor, /session creation timed out/iu);
    assert.equal(creationSignals[0]?.aborted, true);

    creation.resolve({
      sample: async () => ({
        runtimeLabel: "Canlı",
        incidentVisible: false,
        reconnectCursorAdvanced: false,
        pageErrors: [],
      }),
      screenshot: async () => undefined,
      close: () => new Promise(() => undefined),
      forceClose: async () => {
        log.push("force-close");
      },
    });
    await waitFor(() => log.includes("force-close"));
    assert.deepEqual(log, ["force-close"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor owns a session that resolves synchronously from deadline cancellation", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  const log: string[] = [];
  try {
    await assert.rejects(
      runBrowserMonitor({
        runId: "cancel-resolution",
        outputDirectory: directory,
        sampleCount: 1,
        sampleIntervalMs: 1,
        operationTimeoutMs: 10,
        createSession: (signal) =>
          new Promise<BrowserMonitorSession>((resolve) => {
            signal.addEventListener(
              "abort",
              () =>
                resolve({
                  sample: async () => ({
                    runtimeLabel: "Canlı",
                    incidentVisible: false,
                    reconnectCursorAdvanced: false,
                    pageErrors: [],
                  }),
                  screenshot: async () => undefined,
                  close: () => new Promise(() => undefined),
                  forceClose: async () => {
                    log.push("force-close");
                  },
                }),
              { once: true },
            );
          }),
        sleep: async () => undefined,
        now: () => new Date("2026-09-01T00:00:00.000Z"),
      }),
      /session creation timed out/iu,
    );
    await waitFor(() => log.includes("force-close"));
    assert.deepEqual(log, ["force-close"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor retains cleanup ownership until a hung close is force-closed", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  const log: string[] = [];
  try {
    const result = await runBrowserMonitor({
      runId: "force-close",
      outputDirectory: directory,
      sampleCount: 1,
      sampleIntervalMs: 1,
      operationTimeoutMs: 10,
      createSession: async () => ({
        sample: async () => ({
          runtimeLabel: "Canlı",
          incidentVisible: false,
          reconnectCursorAdvanced: false,
          pageErrors: [],
        }),
        screenshot: async (target) => {
          writeFileSync(target, "png", "utf8");
        },
        close: async () => {
          log.push("close");
          await new Promise(() => undefined);
        },
        forceClose: async () => {
          log.push("force-close");
        },
      }),
      sleep: async () => undefined,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(result.pass, true);
    assert.deepEqual(log, ["close", "force-close"]);
    assert.match(result.errors.at(-1) ?? "", /close timed out/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("monitor boundedly retries a transient force-close failure", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  let forceCloseAttempts = 0;
  try {
    const result = await runBrowserMonitor({
      runId: "force-close-retry",
      outputDirectory: directory,
      sampleCount: 1,
      sampleIntervalMs: 1,
      operationTimeoutMs: 10,
      createSession: async () => ({
        sample: async () => ({
          runtimeLabel: "Canlı",
          incidentVisible: false,
          reconnectCursorAdvanced: false,
          pageErrors: [],
        }),
        screenshot: async (target) => {
          writeFileSync(target, "png", "utf8");
        },
        close: () => new Promise(() => undefined),
        forceClose: async () => {
          forceCloseAttempts += 1;
          if (forceCloseAttempts === 1) {
            throw new Error("transient force-close failure");
          }
        },
      }),
      sleep: async () => undefined,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(result.pass, true);
    assert.equal(forceCloseAttempts, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const failingStage of [
  "newContext",
  "listener",
  "goto",
  "waitFor",
] as const) {
  test(`Playwright session force-kills Chromium when ${failingStage} setup fails`, async () => {
    const log: string[] = [];
    const locator = {
      first() {
        return this;
      },
      getAttribute: async () => null,
      innerText: async () => "",
      textContent: async () => null,
      waitFor: async () => {
        log.push("page:waitFor");
        if (failingStage === "waitFor") throw new Error("waitFor failed");
      },
    };
    const page = {
      on: () => {
        log.push("page:on");
        if (failingStage === "listener") throw new Error("listener failed");
        return page;
      },
      getByText: () => locator,
      locator: () => locator,
      goto: async () => {
        log.push("page:goto");
        if (failingStage === "goto") throw new Error("goto failed");
      },
      screenshot: async () => undefined,
      waitForTimeout: async () => undefined,
    };
    const context = {
      close: async () => {
        log.push("context:close");
      },
      newPage: async () => page,
      setOffline: async () => undefined,
    };
    const browser = {
      close: async () => {
        log.push("browser:close");
      },
      newContext: async () => {
        log.push("browser:newContext");
        if (failingStage === "newContext") {
          throw new Error("newContext failed");
        }
        return context;
      },
      version: () => "Chromium test",
    };
    const browserServer = {
      close: async () => {
        log.push("server:close");
      },
      kill: async () => {
        log.push("server:kill");
      },
      wsEndpoint: () => "ws://127.0.0.1:1234/test",
    };
    const chromium = {
      connect: async () => browser,
      launchServer: async () => browserServer,
    };

    await assert.rejects(
      createPlaywrightOperationsSession(
        {
          baseUrl: "http://127.0.0.1:5000",
          projectId: 1,
          operatorToken: "token",
        },
        { loadChromium: async () => chromium },
      ),
      new RegExp(`${failingStage} failed`, "iu"),
    );
    assert.equal(log.includes("server:kill"), true);
    if (failingStage !== "newContext") {
      assert.equal(log.includes("context:close"), true);
    }
    assert.equal(log.includes("browser:close"), true);
  });
}

test("Playwright setup bounds a hung browser-server force kill", async () => {
  const cleanup = createPlaywrightOperationsSession(
    {
      baseUrl: "http://127.0.0.1:5000",
      projectId: 1,
      operatorToken: "token",
      cleanupTimeoutMs: 10,
    },
    {
      loadChromium: async () => ({
        connect: async () => ({
          close: async () => undefined,
          newContext: async () => {
            throw new Error("newContext failed");
          },
          version: () => "Chromium test",
        }),
        launchServer: async () => ({
          close: async () => undefined,
          kill: () => new Promise<void>(() => undefined),
          wsEndpoint: () => "ws://127.0.0.1:1234/test",
        }),
      }),
    },
  );
  let guardTimer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    guardTimer = setTimeout(
      () => reject(new Error("test observed unbounded Playwright cleanup")),
      100,
    );
  });
  try {
    await assert.rejects(
      Promise.race([cleanup, guard]),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.some((item) =>
          /browser server kill timed out/iu.test(String(item)),
        ),
    );
  } finally {
    if (guardTimer) clearTimeout(guardTimer);
  }
});

test("Playwright session gracefully closes context, browser, then server", async () => {
  const log: string[] = [];
  let databaseOutage = false;
  const events = new Map<string, (value: never) => void>();
  let browserClosed = false;
  let cursor = "9007199254740993";
  let transport = "disconnected";
  const locator = {
    first() {
      return this;
    },
    getAttribute: async (name: string) =>
      name === "data-operations-cursor"
        ? cursor
        : name === "data-transport"
          ? transport
          : "Canlı",
    innerText: async () => "",
    textContent: async () => null,
    waitFor: async () => undefined,
  };
  const page = {
    on: (event: string, listener: (value: never) => void) => {
      events.set(event, listener);
      return page;
    },
    getByText: (text: string | RegExp) => {
      assert.equal(text, "Operasyon odası");
      return locator;
    },
    locator: (selector: string) => {
      assert.ok(
        [
          "[data-operations-cursor]",
          '[role="status"][data-runtime]',
          "main",
        ].includes(selector),
      );
      return locator;
    },
    goto: async () => undefined,
    screenshot: async () => undefined,
    waitForTimeout: async () => undefined,
  };
  const context = {
    close: async () => {
      log.push("context:close");
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (browserClosed) throw new Error("browser closed before context");
    },
    newPage: async () => page,
    setOffline: async () => undefined,
  };
  const browser = {
    close: async () => {
      log.push("browser:close");
      browserClosed = true;
    },
    newContext: async (options: Record<string, unknown>) => {
      assert.equal(options.locale, "tr-TR");
      assert.deepEqual(options.storageState, {
        cookies: [],
        origins: [
          {
            origin: "http://127.0.0.1:5000",
            localStorage: [{ name: "acos.locale.v1", value: "tr" }],
          },
        ],
      });
      return context;
    },
    version: () => "Chromium test",
  };
  const browserServer = {
    close: async () => {
      log.push("server:close");
    },
    kill: async () => {
      log.push("server:kill");
    },
    wsEndpoint: () => "ws://127.0.0.1:1234/test",
  };
  const session = await createPlaywrightOperationsSession(
    {
      baseUrl: "http://127.0.0.1:5000",
      projectId: 1,
      operatorToken: "token",
      isExpectedDatabaseOutage: () => databaseOutage,
    },
    {
      loadChromium: async () => ({
        connect: async () => browser,
        launchServer: async () => browserServer,
      }),
    },
  );
  assert.equal((await session.sample()).reconnectCursorAdvanced, false);
  transport = "live";
  assert.equal((await session.sample()).reconnectCursorAdvanced, false);
  cursor = "9007199254740994";
  assert.equal((await session.sample()).reconnectCursorAdvanced, true);
  const emitConsole = (url: string, text: string) =>
    events.get("console")!({
      type: () => "error",
      text: () => text,
      location: () => ({ url }),
    } as never);
  const unavailable =
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)";
  const operationsUrl = "http://127.0.0.1:5000/api/tasks/1/operations";
  emitConsole(operationsUrl, unavailable);
  assert.deepEqual((await session.sample()).pageErrors, [unavailable]);
  databaseOutage = true;
  emitConsole(operationsUrl, unavailable);
  assert.deepEqual((await session.sample()).pageErrors, []);
  emitConsole("https://unrelated.example/api/tasks/1/operations", unavailable);
  emitConsole("http://127.0.0.1:5000/api/unrelated", unavailable);
  emitConsole(operationsUrl, "application invariant failed");
  events.get("pageerror")!(new Error("uncaught application error") as never);
  assert.equal((await session.sample()).pageErrors.length, 4);
  databaseOutage = false;
  emitConsole(operationsUrl, unavailable);
  assert.deepEqual((await session.sample()).pageErrors, [unavailable]);
  await session.close();
  assert.deepEqual(log, ["context:close", "browser:close", "server:close"]);
});

test("Playwright force close retries a failed browser-server kill", async () => {
  let killCalls = 0;
  const locator = {
    first() {
      return this;
    },
    getAttribute: async () => null,
    innerText: async () => "",
    textContent: async () => null,
    waitFor: async () => undefined,
  };
  const page = {
    on: () => page,
    getByText: () => locator,
    locator: () => locator,
    goto: async () => undefined,
    screenshot: async () => undefined,
    waitForTimeout: async () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    setOffline: async () => undefined,
  };
  const browser = {
    close: async () => undefined,
    newContext: async () => context,
    version: () => "Chromium test",
  };
  const browserServer = {
    close: async () => undefined,
    kill: async () => {
      killCalls += 1;
      if (killCalls === 1) throw new Error("transient kill failure");
    },
    wsEndpoint: () => "ws://127.0.0.1:1234/test",
  };
  const session = await createPlaywrightOperationsSession(
    {
      baseUrl: "http://127.0.0.1:5000",
      projectId: 1,
      operatorToken: "token",
    },
    {
      loadChromium: async () => ({
        connect: async () => browser,
        launchServer: async () => browserServer,
      }),
    },
  );
  assert.ok(session.forceClose);
  await assert.rejects(session.forceClose(), /transient kill failure/iu);
  await session.forceClose();
  assert.equal(killCalls, 2);
});

test("monitor rejects a checkpoint directory redirected through a junction", async (context) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-external-"),
  );
  const linkedDirectory = path.join(directory, "linked-checkpoints");
  let screenshotCalled = false;
  try {
    try {
      await symlink(
        externalDirectory,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      runBrowserMonitor({
        runId: "linked-checkpoints",
        outputDirectory: linkedDirectory,
        sampleCount: 1,
        sampleIntervalMs: 1,
        createSession: async () => ({
          sample: async () => ({
            runtimeLabel: "Canlı",
            incidentVisible: false,
            reconnectCursorAdvanced: false,
            pageErrors: [],
          }),
          screenshot: async (target) => {
            screenshotCalled = true;
            await writeFile(target, "escaped", "utf8");
          },
          close: async () => undefined,
        }),
        sleep: async () => undefined,
        now: () => new Date("2026-09-01T00:00:00.000Z"),
      }),
      /checkpoint.*directory|redirected|real directory/iu,
    );
    assert.equal(screenshotCalled, false);
    assert.deepEqual(await readdir(externalDirectory), []);
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(externalDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("monitor never overwrites a pre-existing checkpoint", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-browser-monitor-"),
  );
  const target = path.join(directory, "existing-000-start.png");
  await writeFile(target, "original", "utf8");
  try {
    await assert.rejects(
      runBrowserMonitor({
        runId: "existing",
        outputDirectory: directory,
        sampleCount: 1,
        sampleIntervalMs: 1,
        createSession: async () => ({
          sample: async () => ({
            runtimeLabel: "Canlı",
            incidentVisible: false,
            reconnectCursorAdvanced: false,
            pageErrors: [],
          }),
          screenshot: async (checkpointPath) =>
            writeFile(checkpointPath, "replacement", "utf8"),
          close: async () => undefined,
        }),
        sleep: async () => undefined,
        now: () => new Date("2026-09-01T00:00:00.000Z"),
      }),
      /checkpoint.*already exists/iu,
    );
    assert.equal(await readFile(target, "utf8"), "original");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
