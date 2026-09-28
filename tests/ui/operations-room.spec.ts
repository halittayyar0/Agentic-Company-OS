import {
  inspectRoute,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import {
  loadOperationsCopy,
  operationsPresentation,
} from "../../artifacts/agentic-company-os/src/lib/operations-copy";
import { expect, test, type Page, type Route } from "@playwright/test";

const NOW = "2026-09-01T12:00:00.000Z";

const operationLocales = [
  "tr",
  "en",
  "de",
  "ru",
  "zh-CN",
  "zh-TW",
  "ar",
] as const;
async function noHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}
for (const locale of operationLocales) {
  test(`operations ${locale}: phone evidence, focus and uncertain reconciliation stay scoped`, async ({
    page,
  }, testInfo) => {
    const c = await loadOperationsCopy(locale);
    const p = operationsPresentation(c, locale);
    await page.setViewportSize({ width: 320, height: 850 });
    await page.addInitScript(
      ({ locale }) => {
        localStorage.setItem("acos.locale.v1", locale);
        localStorage.setItem("acos.color-mode.v2", "light");
      },
      { locale },
    );
    let recorded = false;
    let submissions = 0;
    const sourceNote = "External source record — 外部記錄 — السجل الأصلي";
    const unexpected = await installOperationsMocks(page, {
      projectSnapshot: () => ({
        ...projectOperations,
        attempts: projectOperations.attempts.map((attempt) => ({
          ...attempt,
          modelId: "source-model-" + "x".repeat(140),
        })),
        receipts: projectOperations.receipts.map((row) =>
          recorded
            ? {
                ...row,
                reconciliation: {
                  eligible: false,
                  decision: "confirmed_applied",
                  reconciledAt: NOW,
                },
              }
            : row,
        ),
      }),
      handleReconciliation: async () => {
        submissions++;
        recorded = true;
        return { status: 503, body: { error: "response lost after commit" } };
      },
    });
    await page.goto("/operations");
    await expect(
      page.getByRole("heading", { name: c.fleetTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("worker-public-a", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(p.t("effective", { state: c.state_stale }), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await noHorizontalOverflow(page);
    await page.goto("/projects/101/operations");
    await expect(
      page.getByRole("heading", {
        name: "Kesintisiz ürün nöbeti",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(c.sourceHelp, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^24|^Состояние|^نافذة/ }),
    ).toHaveCount(1);
    const inspect = page.getByRole("button", {
      name: p.t("inspectAttempt", { id: "attempt-ui-1" }),
      exact: true,
    });
    await inspect.click();
    const sheet = page.getByRole("dialog", {
      name: c.attemptEvidence,
      exact: true,
    });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByText("logical-ui-1", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(inspect).toBeFocused();
    const opener = page.getByRole("button", { name: c.reconcile, exact: true });
    await expect
      .poll(async () => (await opener.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await opener.click();
    const dialog = page.getByRole("alertdialog", {
      name: c.reconcileTitle,
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: c.cancel, exact: true }),
    ).toBeFocused();
    const save = dialog.getByRole("button", { name: c.save, exact: true });
    await save.click();
    const applied = dialog.getByRole("radio", { name: c.applied, exact: true });
    await expect(applied).toBeFocused();
    await expect(
      dialog.getByText(c.decisionRequired, { exact: true }),
    ).toBeVisible();
    await applied.click();
    await save.click();
    const note = dialog.getByRole("textbox", { name: c.note, exact: true });
    await expect(note).toBeFocused();
    await note.fill(sourceNote);
    await save.click();
    await expect(dialog.getByText(c.uncertain, { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(note).toHaveValue(sourceNote);
    await dialog
      .getByRole("button", { name: c.checkRecord, exact: true })
      .click();
    await expect(
      dialog.getByText(p.t("recordConfirmed", { decision: c.applied }), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(note).toHaveValue(sourceNote);
    expect(submissions).toBe(1);
    await noHorizontalOverflow(page);
    if (locale === "en" || locale === "ar") {
      await page.screenshot({
        path: testInfo.outputPath("operations-review-phone.png"),
        fullPage: true,
      });
      await dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      await dialog.screenshot({
        path: testInfo.outputPath("operations-review-top.png"),
      });
      await dialog
        .getByRole("button", { name: c.cancel, exact: true })
        .scrollIntoViewIfNeeded();
      await dialog.screenshot({
        path: testInfo.outputPath("operations-review-actions.png"),
      });
    }
    await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", {
        name: "Kesintisiz ürün nöbeti",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      page
        .getByRole("region", { name: c.receiptTitle, exact: true })
        .getByText(c.appliedRecord, { exact: true }),
    ).toBeVisible();
    expect([...unexpected]).toEqual([]);
  });
}

test("operations: a failed fleet detail refresh preserves dated records", async ({
  page,
}) => {
  await installOperationsMocks(page, { failInstancesAfterFirst: true });
  await page.goto("/operations");
  await expect(
    page.getByText("worker-public-a", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  await expect(page.getByText(/Süreç listesi yenilenemedi/)).toBeVisible();
  await expect(
    page.getByText("worker-public-a", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Runtime filosu" })
      .getByText(/Europe\/Istanbul/),
  ).toBeVisible();
});

test("operations: missing selected-language asset keeps operation controls unmounted", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installOperationsMocks(page);
  await page.route("**/assets/operations-en-*.js", (route) => route.abort());
  await page.goto("/projects/101/operations");
  await expect(
    page.getByRole("alert").filter({ hasText: /language/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reconcile outcome", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __operationsStreamUrls?: string[] })
          .__operationsStreamUrls,
    ),
  ).toEqual([]);
});

const runtime = {
  state: "local_demo",
  reasons: ["pglite_process_lifetime"],
  databaseBackend: "pglite",
  durable: false,
  multiProcessCapable: false,
  emergencyStopEnabled: false,
  healthyWorkerCount: 0,
  staleWorkerCount: 0,
  schedulerTickAgeMs: null,
  lastSampleAt: "2026-09-01T11:59:00.000Z",
};

function healthSample(
  bucketAt: string,
  state: "live" | "degraded" | "offline",
) {
  return {
    bucketAt,
    sampledAt: bucketAt,
    runtimeTruthState: state,
    providerMetricsCoverage: "partial",
    healthyWorkerCount: state === "live" ? 2 : 0,
    staleWorkerCount: state === "degraded" ? 1 : 0,
    schedulerTickAgeMs: 500,
    dueQueueDepth: 1,
    oldestDueAgeMs: 20_000,
    activeTaskCount: 2,
    sleepingTaskCount: 1,
    recoveringTaskCount: 0,
    blockedTaskCount: 0,
    approvalWaitingTaskCount: 1,
    providerSuccessCount: 1,
    providerErrorCount: 0,
    providerP50LatencyMs: null,
    providerP95LatencyMs: null,
    recoveryCount: 0,
    lostLeaseCount: 0,
    taskTokens: 25,
    reportedCostUsd: 0,
  };
}

const samples = [
  healthSample("2026-09-01T11:57:00.000Z", "live"),
  healthSample("2026-09-01T11:58:00.000Z", "degraded"),
  healthSample("2026-09-01T11:59:00.000Z", "offline"),
];

const projectOperations = {
  generatedAt: "2026-09-01T11:59:59.000Z",
  cursor: "9007199254740993",
  window: {
    startAt: "2026-08-31T12:00:00.000Z",
    endAt: NOW,
    hours: 24,
    timezone: "UTC",
  },
  rootTask: {
    id: 101,
    title: "Kesintisiz ürün nöbeti",
    status: "in_progress",
  },
  runtime,
  queue: {
    dueDepth: 2,
    oldestDueAgeMs: 62_000,
    nextWakeAt: "2026-09-01T12:03:00.000Z",
  },
  taskCounts: {
    active: 2,
    sleeping: 1,
    recovering: 0,
    blocked: 0,
    awaitingApproval: 1,
  },
  members: [
    {
      agentId: 1,
      name: "Mina",
      role: "Operasyon",
      avatar: { color: "#315bff", version: null },
      status: "working",
      presence: "working",
      currentAction: "Kalıcı teslim kanıtını doğruluyor",
      lastActiveAt: "2026-09-01T11:59:58.000Z",
      activeAttemptId: "attempt-ui-1",
      nextWakeAt: null,
    },
    {
      agentId: 2,
      name: "Ada",
      role: "Araştırma",
      avatar: { color: "#138a63", version: null },
      status: "idle",
      presence: "sleeping",
      currentAction: null,
      lastActiveAt: "2026-09-01T11:50:00.000Z",
      activeAttemptId: null,
      nextWakeAt: "2026-09-01T12:03:00.000Z",
    },
  ],
  attempts: [
    {
      id: "attempt-ui-1",
      taskId: 101,
      agentId: 1,
      workerInstanceId: "worker-ui-a",
      logicalExecutionId: "logical-ui-1",
      attemptNumber: 2,
      cycleNumber: 4,
      state: "running",
      startedAt: "2026-09-01T11:58:20.000Z",
      lastHeartbeatAt: "2026-09-01T11:59:58.000Z",
      finishedAt: null,
      provider: "openrouter",
      modelId: "openai/gpt-5-mini",
      failureKind: null,
      recoveryOfAttemptId: "attempt-ui-0",
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      reportedCostUsd: 0.02,
    },
  ],
  receipts: [
    {
      id: "receipt-ui-unknown",
      taskId: 101,
      agentId: 1,
      originAttemptId: "attempt-ui-1",
      executionKind: "task_step",
      sideEffectClass: "at_most_once",
      state: "unknown",
      toolName: "browser_click",
      reservedAt: "2026-09-01T11:58:20.000Z",
      startedAt: "2026-09-01T11:58:21.000Z",
      finishedAt: "2026-09-01T11:58:22.000Z",
      failureKind: "worker_lost_after_effect",
      reconciliation: {
        eligible: true,
        decision: null,
        reconciledAt: null,
      },
      invocations: [
        {
          id: "invocation-ui-1",
          state: "unknown",
          attemptId: "attempt-ui-1",
          workerInstanceId: "worker-ui-a",
          claimedAt: "2026-09-01T11:58:20.000Z",
          lastHeartbeatAt: "2026-09-01T11:58:21.000Z",
          effectStartedAt: "2026-09-01T11:58:21.000Z",
          finishedAt: "2026-09-01T11:58:22.000Z",
          failureKind: "worker_lost_after_effect",
        },
      ],
    },
  ],
  incidents: [
    {
      id: "72",
      kind: "worker_recovered",
      severity: "warning",
      occurredAt: "2026-09-01T11:59:00.000Z",
      taskId: 101,
      agentId: 1,
      attemptId: "attempt-ui-1",
      receiptId: null,
    },
  ],
  milestones: [
    {
      id: "71",
      kind: "handoff_completed",
      severity: "info",
      occurredAt: "2026-09-01T11:58:00.000Z",
      taskId: 101,
      agentId: 1,
      attemptId: "attempt-ui-1",
      receiptId: "receipt-ui-unknown",
    },
  ],
  usage: {
    taskTokens: 125,
    reportedCostUsd: 0.02,
    usageEvents: 1,
    costReportedEvents: 1,
    providerMetricsCoverage: "partial",
  },
  fleetHealthSamples: samples,
  limits: {
    attempts: 200,
    receipts: 200,
    invocationsPerReceipt: 5,
    incidents: 100,
    milestones: 100,
    samples: 1440,
  },
  truncation: {
    attempts: false,
    receipts: false,
    incidents: false,
    milestones: false,
    fleetHealthSamples: false,
  },
};

const overview = {
  generatedAt: "2026-09-01T11:59:59.000Z",
  cursor: "88",
  window: projectOperations.window,
  runtime: {
    ...runtime,
    state: "live",
    databaseBackend: "postgresql",
    durable: true,
    multiProcessCapable: true,
    healthyWorkerCount: 2,
  },
  queue: projectOperations.queue,
  tasks: projectOperations.taskCounts,
  operations: { reserved: 3, running: 2, unresolvedUnknown: 1 },
  usage: projectOperations.usage,
  fleetHealthSamples: samples,
  truncation: { fleetHealthSamples: false },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installOperationsMocks(
  page: Page,
  options: {
    beforeProjectResponse?: () => Promise<void>;
    failProjectAfterFirst?: boolean;
    failInstancesAfterFirst?: boolean;
    projectSnapshot?: () => unknown;
    receiptReview?: () => { status: number; body: unknown };
    handleReconciliation?: (input: {
      receiptId: string;
      payload: unknown;
      requestNumber: number;
    }) => Promise<{ status: number; body: unknown }>;
  } = {},
) {
  await page.addInitScript(() => {
    const streamWindow = window as typeof window & {
      __operationsStreamUrls?: string[];
    };
    streamWindow.__operationsStreamUrls = [];
    class StableEventSource extends EventTarget {
      readonly url: string;
      readonly withCredentials = false;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readyState = 1;
      timer: number;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        streamWindow.__operationsStreamUrls?.push(this.url);
        this.timer = window.setTimeout(() => {
          this.dispatchEvent(new MessageEvent("open"));
          this.dispatchEvent(
            new MessageEvent("heartbeat", {
              data: JSON.stringify({ at: new Date().toISOString() }),
            }),
          );
        }, 10);
      }

      close() {
        window.clearTimeout(this.timer);
        this.readyState = this.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: StableEventSource,
    });
  });

  const unexpected = new Set<string>();
  let projectRequestCount = 0;
  let instanceRequestCount = 0;
  let reconciliationRequestCount = 0;
  let lastNote = "Previously recorded external evidence.";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/status") {
      return json(route, {
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      });
    }
    if (path === "/api/settings/locale" && request.method() === "PUT") {
      return json(route, request.postDataJSON());
    }
    if (path === "/api/ops/control") {
      return json(route, {
        emergencyStopEnabled: false,
        reason: null,
        version: 1,
        updatedBy: "operations-ui-spec",
        updatedAt: NOW,
        blockedScopes: [
          "agent_chat",
          "task_scheduler",
          "agent_tools",
          "approved_actions",
        ],
      });
    }
    if (path === "/api/healthz") return json(route, { status: "ok" });
    if (path === "/api/org/summary") {
      return json(route, {
        totalAgents: 2,
        activeAgents: 2,
        workingAgents: 1,
        tasksInProgress: 2,
        tasksAwaitingApproval: 1,
        tasksCompletedToday: 0,
        pendingApprovals: 1,
        tokensUsedToday: 125,
        estimatedCostTodayUsd: 0.02,
        usageEventsToday: 1,
        costReportedEventsToday: 1,
      });
    }
    if (path === "/api/tasks/101/operations/receipts/receipt-ui-unknown") {
      if (options.receiptReview) {
        const result = options.receiptReview();
        return json(route, result.body, result.status);
      }
      const snapshot = (options.projectSnapshot?.() ??
        projectOperations) as typeof projectOperations;
      const receipt = snapshot.receipts.find(
        (r) => r.id === "receipt-ui-unknown",
      );
      if (!receipt) return json(route, { error: "not found" }, 404);
      return json(route, {
        projectId: 101,
        receipt,
        audit: receipt.reconciliation.decision
          ? {
              receiptId: receipt.id,
              state: "unknown",
              decision: receipt.reconciliation.decision,
              note: lastNote,
              actorId: "operator-audit",
              reconciledAt: receipt.reconciliation.reconciledAt,
            }
          : null,
      });
    }
    if (path === "/api/tasks/101/operations") {
      projectRequestCount += 1;
      await options.beforeProjectResponse?.();
      if (options.failProjectAfterFirst && projectRequestCount > 1) {
        return json(route, { error: "temporary read failure" }, 503);
      }
      return json(route, options.projectSnapshot?.() ?? projectOperations);
    }
    if (
      path === "/api/ops/receipts/receipt-ui-unknown/reconcile" &&
      request.method() === "POST" &&
      options.handleReconciliation
    ) {
      reconciliationRequestCount += 1;
      lastNote = request.postDataJSON().note;
      const result = await options.handleReconciliation({
        receiptId: "receipt-ui-unknown",
        payload: request.postDataJSON(),
        requestNumber: reconciliationRequestCount,
      });
      return json(route, result.body, result.status);
    }
    if (path === "/api/ops/overview") return json(route, overview);
    if (path === "/api/ops/instances") {
      instanceRequestCount++;
      if (options.failInstancesAfterFirst && instanceRequestCount > 1)
        return json(route, { error: "read unavailable" }, 503);
      return json(route, {
        generatedAt: NOW,
        truncated: false,
        instances: [
          {
            id: "worker-public-a",
            role: "worker",
            persistedState: "healthy",
            effectiveState: "stale",
            buildVersion: "0.1.0",
            capabilities: { scheduler: true },
            schedulerEnabled: true,
            startedAt: "2026-09-01T10:00:00.000Z",
            lastHeartbeatAt: "2026-09-01T11:59:30.000Z",
            heartbeatAgeMs: 30_000,
            lastSchedulerTickAt: "2026-09-01T11:59:29.000Z",
            schedulerTickAgeMs: 31_000,
            drainingAt: null,
            stoppedAt: null,
          },
        ],
      });
    }
    unexpected.add(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected operations API request" }, 501);
  });
  return unexpected;
}

test.describe("Operations Room", () => {
  test("project stream starts only after the authorized HTTP snapshot succeeds", async ({
    page,
  }) => {
    let releaseResponse = () => undefined;
    let markRequested = () => undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestSeen = new Promise<void>((resolve) => {
      markRequested = resolve;
    });
    await installOperationsMocks(page, {
      beforeProjectResponse: async () => {
        markRequested();
        await responseGate;
      },
    });

    const navigation = page.goto("/projects/101/operations");
    await requestSeen;
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __operationsStreamUrls?: string[] })
              .__operationsStreamUrls?.length ?? 0,
        ),
      )
      .toBe(0);

    releaseResponse();
    await navigation;
    await expect(
      page.getByRole("heading", { name: "Kesintisiz ürün nöbeti" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __operationsStreamUrls?: string[] })
              .__operationsStreamUrls?.length ?? 0,
        ),
      )
      .toBe(1);
  });

  test("project room makes 24-hour truth, team work, recovery and receipts enjoyable to inspect", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    const unexpected = await installOperationsMocks(page);
    await page.goto("/projects/101/operations");

    await expect(
      page.getByRole("heading", { name: "Kesintisiz ürün nöbeti" }),
    ).toBeVisible();
    await expect(page.getByText("Yerel demo · kalıcı değil")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /24 saatlik sağlık penceresi/ }),
    ).toContainText("");
    await expect(page.getByText(/1\.437 bilinmeyen/)).toBeVisible();
    await expect(
      page.getByText("Kalıcı teslim kanıtını doğruluyor"),
    ).toBeVisible();
    await expect(page.getByText("Worker yeniden devrede")).toBeVisible();
    await expect(page.getByText("Toparlanma denemesi")).toBeVisible();
    await expect(page.getByText("Tekrar oynatılmaz")).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Etki makbuzları" })
        .getByText("receipt-ui-unknown", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kanıt zinciri" }),
    ).toBeVisible();
    const evidenceInspector = page.getByRole("complementary", {
      name: "Kanıt zinciri",
    });
    await expect(
      evidenceInspector.getByText("logical-ui-1", { exact: true }),
    ).toBeVisible();
    await expect(
      evidenceInspector.getByText("invocation-ui-1", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "İncele: 1 dk Kısıtlı" }).click();
    await expect(page.getByText("Zaman filtresi")).toBeVisible();
    await expect(page.getByText("attempt-ui-1").first()).toBeVisible();

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      page.getByRole("heading", { name: "Kesintisiz ürün nöbeti" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Deneme attempt-ui-1 kanıtını incele",
      })
      .click();
    const mobileInspector = page.getByRole("dialog", {
      name: "Deneme kanıtı",
    });
    await expect(mobileInspector).toBeVisible();
    await expect(
      mobileInspector.getByText("logical-ui-1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Kapat" }).click();
    await expect(mobileInspector).toBeHidden();
    const narrowWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(narrowWidth.scroll).toBeLessThanOrEqual(narrowWidth.client);
    expect([...unexpected]).toEqual([]);
  });

  test("truncated evidence is disclosed and unknown receipts reconcile pessimistically", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    let reconciled = false;
    let markFirstRequest = () => undefined;
    let releaseFirstRequest = () => undefined;
    const firstRequestSeen = new Promise<void>((resolve) => {
      markFirstRequest = resolve;
    });
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    const submissions: unknown[] = [];
    const unexpected = await installOperationsMocks(page, {
      projectSnapshot: () => ({
        ...projectOperations,
        receipts: projectOperations.receipts.map((receipt) =>
          receipt.id === "receipt-ui-unknown" && reconciled
            ? {
                ...receipt,
                reconciliation: {
                  eligible: false,
                  decision: "confirmed_not_applied",
                  reconciledAt: NOW,
                },
              }
            : receipt,
        ),
        truncation: {
          attempts: true,
          receipts: false,
          incidents: true,
          milestones: false,
          fleetHealthSamples: true,
        },
      }),
      handleReconciliation: async ({ payload, requestNumber }) => {
        submissions.push(payload);
        if (requestNumber === 1) {
          markFirstRequest();
          await firstRequestGate;
          return {
            status: 503,
            body: { error: "temporary reconciliation outage" },
          };
        }
        reconciled = true;
        return {
          status: 200,
          body: {
            receiptId: "receipt-ui-unknown",
            state: "unknown",
            decision: "confirmed_not_applied",
            note: "Harici kayıt kontrol edildi; işlem uygulanmamış.",
            actorId: "operator-audit",
            reconciledAt: NOW,
          },
        };
      },
    });
    await page.goto("/projects/101/operations");

    await expect(page.getByText("Sınırlı kanıt görünümü")).toBeVisible();
    await expect(
      page.getByText("Denemeler: 200 kayıt sınırına ulaşıldı"),
    ).toBeVisible();
    await expect(page.getByText("Kayıt zaman dilimi: UTC")).toBeVisible();
    await expect(page.getByText("Gösterim: Europe/Istanbul")).toBeVisible();

    await page.getByRole("button", { name: "Sonucu uzlaştır" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Belirsiz dış etkiyi uzlaştır",
    });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Vazgeç" })).toBeFocused();
    await page.getByRole("radio", { name: "Dış etki uygulanmadı" }).click();
    await page.getByRole("button", { name: "Kararı kaydet" }).click();
    await expect(page.getByText("Denetim notu zorunlu.")).toBeVisible();
    expect(submissions).toHaveLength(0);

    const note = page.getByRole("textbox", { name: "Denetim notu" });
    await note.fill("  Harici kayıt kontrol edildi; işlem uygulanmamış.  ");
    await page.getByRole("button", { name: "Kararı kaydet" }).click();
    await firstRequestSeen;
    await expect(
      page.getByRole("button", { name: "Kararı kaydet" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Kararı kaydet" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(submissions).toHaveLength(1);
    releaseFirstRequest();

    await expect(page.getByText(/Kaydetme sonucu doğrulanamadı/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Kararı kaydet" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Son kaydı kontrol et" }).click();
    await expect(page.getByText(/Makbuz hâlâ karar bekliyor/)).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Dış etki uygulandı", exact: true }),
    ).toBeDisabled();
    await expect(note).toHaveAttribute("readonly", "");
    await expect(note).toHaveValue(
      "  Harici kayıt kontrol edildi; işlem uygulanmamış.  ",
    );
    await page.getByRole("button", { name: "Kararı kaydet" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Uzlaştırma kararı kaydedildi", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Etki makbuzları" })
        .getByText("Dış etki uygulanmadı olarak doğrulandı", { exact: true }),
    ).toBeVisible();
    expect(submissions).toEqual([
      {
        decision: "confirmed_not_applied",
        note: "Harici kayıt kontrol edildi; işlem uygulanmamış.",
      },
      {
        decision: "confirmed_not_applied",
        note: "Harici kayıt kontrol edildi; işlem uygulanmamış.",
      },
    ]);
    expect([...unexpected]).toEqual([]);
  });

  test("a failed refresh keeps the last durable project snapshot visible", async ({
    page,
  }) => {
    await installOperationsMocks(page, { failProjectAfterFirst: true });
    await page.goto("/projects/101/operations");
    await expect(
      page.getByRole("heading", { name: "Kesintisiz ürün nöbeti" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Yenile" }).click();
    await expect(page.getByText("Son görünüm korunuyor")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kesintisiz ürün nöbeti" }),
    ).toBeVisible();
  });

  test("global command center separates persisted and effective worker state", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const unexpected = await installOperationsMocks(page);
    await page.goto("/operations");

    await expect(
      page.getByRole("heading", { name: "Operasyon merkezi" }),
    ).toBeVisible();
    await expect(page.getByText("Canlı · 2 worker")).toBeVisible();
    await expect(page.getByText("worker-public-a")).toBeVisible();
    await expect(page.getByText("Kayıtlı: Sağlıklı")).toBeVisible();
    await expect(page.getByText("Hesaplanan: Gecikmiş")).toBeVisible();
    await expect(page.getByText("Sonucu belirsiz")).toBeVisible();

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
    expect([...unexpected]).toEqual([]);
  });

  test("legacy activity bookmarks preserve query state and focus the canonical operations heading once", async ({
    page,
  }) => {
    const unexpected = await installOperationsMocks(page);
    await page.goto("/activity?severity=warning&agentId=2#recent");
    await expect(page).toHaveURL(
      /\/operations\?severity=warning&agentId=2#recent$/,
    );
    const heading = page.getByRole("heading", {
      level: 1,
      name: "Operasyon merkezi",
    });
    await expect(heading).toBeFocused();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle("Operasyon Merkezi — Agentic Company OS");
    await expect(page.locator('a[href="/activity"]')).toHaveCount(0);
    const refresh = page.getByRole("button", { name: "Yenile", exact: true });
    await refresh.click();
    await expect(refresh).toBeFocused();
    expect([...unexpected]).toEqual([]);
  });

  test("project room keeps its hierarchy and width in the light theme", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.setItem("acos.color-mode.v2", "light");
    });
    await installOperationsMocks(page);
    await page.goto("/projects/101/operations");

    await expect(page.locator("html")).toHaveClass(/light/);
    await expect(
      page.getByRole("heading", { name: "Kesintisiz ürün nöbeti" }),
    ).toBeVisible();
    await expect(page.getByText("Yerel demo · kalıcı değil")).toBeVisible();
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
  });
});

test("operations: snapshot eviction cannot dismiss or reset an in-flight reconciliation", async ({
  page,
}) => {
  await page.clock.install();
  let omitReceipt = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen!: () => void;
  const started = new Promise<void>((resolve) => {
    seen = resolve;
  });
  let missingReads = 0;
  await installOperationsMocks(page, {
    projectSnapshot: () => {
      if (omitReceipt) missingReads++;
      return {
        ...projectOperations,
        receipts: omitReceipt ? [] : projectOperations.receipts,
      };
    },
    handleReconciliation: async () => {
      seen();
      await gate;
      return { status: 503, body: { error: "reply unavailable" } };
    },
  });
  await page.goto("/projects/101/operations");
  await page
    .getByRole("button", { name: "Sonucu uzlaştır", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  const note = dialog.getByRole("textbox", {
    name: "Denetim notu",
    exact: true,
  });
  await dialog
    .getByRole("radio", { name: "Dış etki uygulanmadı", exact: true })
    .click();
  await note.fill(
    "Original evidence must survive a bounded snapshot eviction.",
  );
  await page.clock.runFor(15000);
  const save = dialog.getByRole("button", {
    name: "Kararı kaydet",
    exact: true,
  });
  await save.click();
  await started;
  omitReceipt = true;
  await page.clock.runFor(6000);
  await expect.poll(() => missingReads).toBeGreaterThan(0);
  await expect(dialog).toBeVisible();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeDisabled();
  release();
  await expect(dialog.getByText(/Kaydetme sonucu doğrulanamadı/)).toBeVisible();
  await dialog.getByRole("button", { name: "Son kaydı kontrol et" }).click();
  await expect(dialog.getByText(/Makbuz sunucuda bulunamadı/)).toBeVisible();
  await expect(note).toHaveValue(
    "Original evidence must survive a bounded snapshot eviction.",
  );
  await expect(save).toBeDisabled();
});

test("operations: opposite recorded decision remains immutable after a lost response", async ({
  page,
}) => {
  let opposite = false;
  let posts = 0;
  await installOperationsMocks(page, {
    projectSnapshot: () => ({
      ...projectOperations,
      receipts: projectOperations.receipts.map((r) =>
        opposite
          ? {
              ...r,
              reconciliation: {
                eligible: false,
                decision: "confirmed_not_applied",
                reconciledAt: NOW,
              },
            }
          : r,
      ),
    }),
    handleReconciliation: async () => {
      opposite = true;
      posts++;
      return { status: 409, body: { error: "decision already recorded" } };
    },
  });
  await page.goto("/projects/101/operations");
  await page
    .getByRole("button", { name: "Sonucu uzlaştır", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("radio", { name: "Dış etki uygulandı", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Denetim notu" })
    .fill("An independently checked source.");
  await dialog.getByRole("button", { name: "Kararı kaydet" }).click();
  await expect(dialog.getByText(/Kaydetme sonucu doğrulanamadı/)).toBeVisible();
  await dialog.getByRole("button", { name: "Son kaydı kontrol et" }).click();
  await expect(
    dialog.getByText(/Sunucuda kayıtlı karar: Dış etki uygulanmadı/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Kararı kaydet" }),
  ).toBeDisabled();
  expect(posts).toBe(1);
});

test("operations recovery: reload restores exact input outside history; checking never writes", async ({
  page,
}) => {
  const c = await loadOperationsCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  let submitted = false;
  let posts = 0;
  const note = "Verified external source 原文 دليل";
  const r = projectOperations.receipts[0];
  await installOperationsMocks(page, {
    projectSnapshot: () => ({
      ...projectOperations,
      receipts: submitted ? [] : projectOperations.receipts,
    }),
    receiptReview: () => ({
      status: 200,
      body: {
        projectId: 101,
        receipt: {
          ...r,
          reconciliation: {
            eligible: false,
            decision: "confirmed_applied",
            reconciledAt: NOW,
          },
        },
        audit: {
          receiptId: r.id,
          state: "unknown",
          decision: "confirmed_applied",
          note,
          actorId: "operator-original",
          reconciledAt: NOW,
        },
      },
    }),
    handleReconciliation: async () => {
      submitted = true;
      posts++;
      return { status: 503, body: { error: "lost after commit" } };
    },
  });
  await page.goto("/projects/101/operations");
  await page.getByRole("button", { name: c.reconcile, exact: true }).click();
  let dialog = page.getByRole("alertdialog");
  await dialog.getByRole("radio", { name: c.applied, exact: true }).click();
  await dialog.getByRole("textbox", { name: c.note, exact: true }).fill(note);
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog.getByText(c.uncertain, { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Review saved decision", exact: true })
    .click();
  dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("textbox", { name: c.note, exact: true }),
  ).toHaveValue(note);
  await expect(
    dialog.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: c.checkRecord, exact: true })
    .click();
  await expect(
    dialog.getByText("operator-original", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await dialog
    .getByRole("button", { name: "Acknowledge recorded decision", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.operation-intent.v1:101"),
    ),
  ).toBeNull();
});

test("operations recovery: ordinary draft survives reload; byte overflow and unavailable storage dispatch nothing", async ({
  page,
}) => {
  const c = await loadOperationsCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  let posts = 0;
  await installOperationsMocks(page, {
    handleReconciliation: async () => {
      posts++;
      return { status: 503, body: {} };
    },
  });
  await page.goto("/projects/101/operations");
  const open = () =>
    page.getByRole("button", { name: c.reconcile, exact: true }).click();
  await open();
  const dialog = page.getByRole("alertdialog");
  const note = dialog.getByRole("textbox", { name: c.note, exact: true });
  await dialog.getByRole("radio", { name: c.applied, exact: true }).click();
  await note.fill("  Unsent 原文  ");
  await page.reload();
  await open();
  await expect(note).toHaveValue("  Unsent 原文  ");
  await note.fill("界".repeat(667));
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog.locator("#reconciliation-note-error")).toBeVisible();
  expect(posts).toBe(0);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage denied");
    };
  });
  await note.fill("Valid external proof");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(
    dialog.getByText(
      "Browser storage is unavailable. Your text stays here; nothing was sent. Try saving again after restoring storage.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(posts).toBe(0);
  await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
  await open();
  await expect(note).toHaveValue("Valid external proof");
});

test("operations recovery: reload requires a fresh read before an identical retry; stale intent never dispatches", async ({
  page,
}) => {
  const c = await loadOperationsCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const payloads: unknown[] = [];
  await installOperationsMocks(page, {
    handleReconciliation: async ({ payload }) => {
      payloads.push(payload);
      return { status: 503, body: {} };
    },
  });
  await page.goto("/projects/101/operations");
  await page.getByRole("button", { name: c.reconcile, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("radio", { name: c.notApplied, exact: true }).click();
  await dialog
    .getByRole("textbox", { name: c.note, exact: true })
    .fill("  Unchanged evidence 原文  ");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog.getByText(c.uncertain, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: c.reviewSaved, exact: true }).click();
  const save = dialog.getByRole("button", { name: c.save, exact: true });
  const note = dialog.getByRole("textbox", { name: c.note, exact: true });
  await expect(save).toBeDisabled();
  await expect(note).toHaveValue("Unchanged evidence 原文");
  await expect(note).toHaveAttribute("readonly", "");
  expect(payloads).toHaveLength(1);
  await dialog
    .getByRole("button", { name: c.checkRecord, exact: true })
    .click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog.getByText(c.uncertain, { exact: true })).toBeVisible();
  expect(payloads).toEqual(
    Array(2).fill({
      decision: "confirmed_not_applied",
      note: "Unchanged evidence 原文",
    }),
  );
  await dialog
    .getByRole("button", { name: c.checkRecord, exact: true })
    .click();
  await expect(save).toBeEnabled();
  await page.evaluate(() => {
    const key = "acos.operation-intent.v1:101";
    const old = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(
      key,
      JSON.stringify({
        ...old,
        localId: crypto.randomUUID(),
        note: "Newer saved evidence",
      }),
    );
  });
  await save.click();
  await expect(
    dialog.getByText(c.recoveryBlocked, { exact: true }),
  ).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.operation-intent.v1:101")!)
          .note,
    ),
  ).toBe("Newer saved evidence");
});

test("operations recovery: damaged data remains visible when the project is unavailable; clearing is explicit", async ({
  page,
}) => {
  const c = await loadOperationsCopy("ar");
  await page.setViewportSize({ width: 320, height: 850 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    sessionStorage.setItem(
      "acos.operation-intent.v1:101",
      '{"damaged": "原文 دليل"',
    );
  });
  await installOperationsMocks(page);
  await page.route("**/api/tasks/101/operations", (route) =>
    json(route, { error: "missing" }, 404),
  );
  await page.goto("/projects/101/operations");
  const panel = page.getByRole("region", {
    name: c.recoveryTitle,
    exact: true,
  });
  await expect(
    panel.getByText(c.recoveryDamaged, { exact: true }),
  ).toBeVisible();
  await expect(panel.locator("pre")).toHaveText('{"damaged": "原文 دليل"');
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await panel.locator("summary").click();
  const clear = panel.getByRole("button", {
    name: c.clearRecovery,
    exact: true,
  });
  await expect(clear).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await noHorizontalOverflow(page);
  await clear.click();
  await expect(panel).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.operation-intent.v1:101"),
    ),
  ).toBeNull();
  await expect(page.locator("#operation-recovery-focus")).toBeFocused();
});

test("operations recovery: a damaged draft is preserved until acknowledged and removed", async ({
  page,
}) => {
  const c = await loadOperationsCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    sessionStorage.setItem(
      "acos.operation-draft.v1:101:receipt-ui-unknown",
      "unreadable 原文",
    );
  });
  await installOperationsMocks(page);
  await page.goto("/projects/101/operations");
  await page.getByRole("button", { name: c.reconcile, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.locator("pre")).toHaveText("unreadable 原文");
  await expect(
    dialog.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  const discard = dialog.getByRole("button", {
    name: c.discardDraft,
    exact: true,
  });
  await expect(discard).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await discard.click();
  await expect(
    dialog.getByRole("button", { name: c.save, exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.operation-draft.v1:101:receipt-ui-unknown"),
    ),
  ).toBeNull();
});

test("operations recovery review: clearing pending state cannot resurrect the old dialog intent", async ({
  page,
}) => {
  const c = await loadOperationsCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installOperationsMocks(page, {
    handleReconciliation: async () => ({ status: 503, body: {} }),
  });
  await page.goto("/projects/101/operations");
  const open = () =>
    page.getByRole("button", { name: c.reconcile, exact: true }).click();
  await open();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("radio", { name: c.applied, exact: true }).click();
  await dialog
    .getByRole("textbox", { name: c.note, exact: true })
    .fill("Old decision deliberately cleared");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog.getByText(c.uncertain, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
  const panel = page.getByRole("region", {
    name: c.recoveryTitle,
    exact: true,
  });
  await panel.locator("summary").click();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: c.clearRecovery, exact: true })
    .click();
  await expect(panel).toBeHidden();
  await open();
  await expect(
    dialog.getByRole("radio", { name: c.applied, exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("textbox", { name: c.note, exact: true }),
  ).toHaveValue("");
});

test("operations recovery review: damaged companion stays reviewable without trapping a recorded decision", async ({
  page,
}) => {
  const c = await loadOperationsCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    sessionStorage.setItem(
      "acos.operation-intent.v1:101",
      JSON.stringify({
        version: 1,
        localId: "87017a64-4911-41ae-87f1-9815c902e23d",
        draftId: null,
        projectId: 101,
        receiptId: "receipt-ui-unknown",
        decision: "confirmed_applied",
        note: "Original proof",
      }),
    );
    sessionStorage.setItem(
      "acos.operation-draft.v1:101:receipt-ui-unknown",
      "damaged companion 原文",
    );
  });
  const r = projectOperations.receipts[0];
  await installOperationsMocks(page, {
    receiptReview: () => ({
      status: 200,
      body: {
        projectId: 101,
        receipt: {
          ...r,
          reconciliation: {
            eligible: false,
            decision: "confirmed_applied",
            reconciledAt: NOW,
          },
        },
        audit: {
          receiptId: r.id,
          state: "unknown",
          decision: "confirmed_applied",
          note: "Original proof",
          actorId: "operator-original",
          reconciledAt: NOW,
        },
      },
    }),
  });
  await page.goto("/projects/101/operations");
  await page.getByRole("button", { name: c.reviewSaved, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.locator("pre")).toHaveText("damaged companion 原文");
  await dialog
    .getByRole("button", { name: c.checkRecord, exact: true })
    .click();
  await dialog
    .getByRole("button", { name: c.acknowledgeRecord, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.operation-intent.v1:101"),
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.operation-draft.v1:101:receipt-ui-unknown"),
    ),
  ).toBe("damaged companion 原文");
});

const registeredEventLabels = {
  tr: "Çalışma süreci kaydedildi",
  en: "Runtime registered",
  de: "Laufzeit registriert",
  ru: "Рабочий процесс зарегистрирован",
  "zh-CN": "运行进程已注册",
  "zh-TW": "執行程序已註冊",
  ar: "تم تسجيل عملية التشغيل",
};
for (const locale of operationLocales) {
  test(`operations ${locale}: canonical event kinds have translated mission labels`, async ({
    page,
  }) => {
    await page.addInitScript(
      (lang) => localStorage.setItem("acos.locale.v1", lang),
      locale,
    );
    await installOperationsMocks(page, {
      projectSnapshot: () => ({
        ...projectOperations,
        milestones: [
          { ...projectOperations.milestones[0], kind: "runtime_registered" },
        ],
      }),
    });
    await page.goto("/projects/101/operations");
    await expect(
      page.getByText(registeredEventLabels[locale], { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/runtime_registered/)).toHaveCount(0);
  });
}

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: fleet and project operations`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors = await prepareRouteAudit(page, variant);
    const unexpected = await installOperationsMocks(page);
    const c = await loadOperationsCopy(locale);
    const presentation = operationsPresentation(c, locale);
    await page.goto("/operations");
    await expect(
      page.getByRole("heading", { name: c.fleetTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("worker-public-a", { exact: true }),
    ).toBeVisible();
    await inspectRoute(page, info, "fleet-operations", variant);
    await page.goto("/projects/101/operations");
    await expect(
      page.getByRole("heading", {
        name: "Kesintisiz ürün nöbeti",
        exact: true,
      }),
    ).toBeVisible();
    if (variant.largeText) {
      const overlaps = await page
        .getByRole("region", { name: presentation.t("teamTitle"), exact: true })
        .getByRole("link")
        .evaluateAll((links) =>
          links
            .filter((link) => {
              const icon = link.firstElementChild!.getBoundingClientRect();
              const name = link
                .querySelector("strong")!
                .getBoundingClientRect();
              return (
                Math.min(icon.right, name.right) >
                  Math.max(icon.left, name.left) &&
                Math.min(icon.bottom, name.bottom) >
                  Math.max(icon.top, name.top)
              );
            })
            .map((link) => link.textContent),
        );
      expect
        .soft(overlaps, "team identities do not overlap their symbols")
        .toEqual([]);
    }
    const attempt = page.getByRole("button", {
      name: presentation.t("inspectAttempt", { id: "attempt-ui-1" }),
      exact: true,
    });
    const identity = attempt.locator("p").filter({ hasText: /^Mina/ });
    await expect(identity).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const nameLines = await identity.evaluate((element) => {
      const name = element.firstChild!;
      const range = document.createRange();
      range.selectNodeContents(name);
      return {
        name: name.textContent,
        lines: [
          ...new Set(
            Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
          ),
        ],
      };
    });
    expect(nameLines.name).toBe("Mina");
    expect(
      nameLines.lines,
      "a short expert name must not wrap letter by letter",
    ).toHaveLength(1);
    await inspectRoute(page, info, "project-operations", variant);
    expect([...unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
