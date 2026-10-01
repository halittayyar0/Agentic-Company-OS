import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadTraceCopy } from "../../artifacts/agentic-company-os/src/lib/trace-copy";
import { loadProjectStudioCopy } from "../../artifacts/agentic-company-os/src/lib/project-studio-copy";

const date = "2026-09-27T09:00:00.000Z";
const root = {
  id: 101,
  title: "Trace source project",
  brief: "Saved task brief",
  status: "completed",
  priority: "normal",
  ownerAgentId: 1,
  assignedByAgentId: null,
  createdByUser: true,
  parentTaskId: null,
  progressPercent: 100,
  tokensUsed: 5,
  estimatedCostUsd: null,
  resultSummary: null,
  executionModelId: "configured-only-model",
  lastModelId: null,
  lastModelProvider: null,
  modelFallbackCount: 0,
  autonomyMode: "finite",
  cadenceSeconds: null,
  lastHeartbeatAt: null,
  recoveryCount: 0,
  cycleCount: 2,
  lastCycleCompletedAt: null,
  lastSteppedAt: null,
  stepAttempts: 7,
  consecutiveFailures: 0,
  nextAttemptAt: null,
  lastError: null,
  blockedReason: null,
  dueAt: null,
  createdAt: date,
  updatedAt: date,
  completedAt: date,
};
const child = {
  ...root,
  id: 102,
  title: "Delegated source task",
  brief: "Original delegation brief",
  ownerAgentId: 999,
  assignedByAgentId: 1,
  parentTaskId: 101,
  status: "in_progress",
  completedAt: null,
};
const second = { ...child, id: 103, title: "Second delegated task" };
const activity = [
  {
    id: 11,
    agentId: 999,
    taskId: 101,
    type: "note",
    summary: "Original tool selection summary",
    severity: "info",
    createdAt: date,
    detail: {
      selectedTool: "browser_navigate",
      outputStored: false,
      url: "https://alice:SECRET@example.com/report?token=SECRET#SECRET",
      command: "RAW_SECRET",
      prompt: "PRIVATE_PROMPT",
    },
  },
  {
    id: 12,
    agentId: 1,
    taskId: 101,
    type: "error",
    summary: "Original error summary",
    severity: "critical",
    createdAt: date,
    detail: { status: "failed" },
  },
];
async function setup(
  page: Page,
  locale: Locale,
  suppliedActivity: readonly unknown[] = activity,
) {
  await page.addInitScript(
    (lang) => localStorage.setItem("acos.locale.v1", lang),
    locale,
  );
  const base = await installStudioFixtures(page);
  const state = { fail: false, childFail: false, childCalls: [] as number[] };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value });
    if (path === "/api/tasks/101") return json(root);
    if (path === "/api/tasks/101/members") return json([]);
    if (path === "/api/tasks/101/subtasks") return json([child, second]);
    if (path === "/api/tasks/101/activity")
      return state.fail
        ? json({ error: "offline" }, 503)
        : json(suppliedActivity);
    const match = path.match(/^\/api\/tasks\/(102|103)\/activity$/);
    if (match) {
      const id = Number(match[1]);
      state.childCalls.push(id);
      if (state.childFail) return json({ error: "offline" }, 503);
      return json([
        {
          ...activity[0],
          id: id + 100,
          taskId: id,
          summary: "Original child note " + id,
          detail: null,
        },
      ]);
    }
    if (path === "/api/agents/1/messages") return json([]);
    return route.fallback();
  });
  return { ...base, state };
}
for (const locale of LOCALES) {
  test(`${locale} completion review shows bounded recorded evidence on mobile`, async ({
    page,
  }, info) => {
    const c = await loadTraceCopy(locale),
      r = c.reviewEvidence;
    const panelRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/completion-review-panel-[^/]+\.js$/u.test(pathname))
        panelRequests.push(pathname);
    });
    await setup(page, locale, [
      {
        id: 44,
        agentId: 1,
        taskId: 101,
        type: "judge_review",
        summary: "Original blocked review",
        severity: "warning",
        createdAt: date,
        detail: {
          verdict: "block",
          completionEvidence: {
            source: "persisted_runtime_metadata",
            taskId: 101,
            cycleNumber: 0,
            receiptTotal: 14,
            receiptCounts: [
              {
                state: "failed",
                reconciliationDecision: "confirmed_not_applied",
                count: 1,
              },
              { state: "failed", reconciliationDecision: null, count: 2 },
              { state: "succeeded", reconciliationDecision: null, count: 10 },
              { state: "unknown", reconciliationDecision: null, count: 1 },
            ],
            receiptsTruncated: true,
            receipts: [
              {
                id: "receipt-1",
                tool: "vm_run_command",
                state: "failed",
                executionKind: "approved_action",
                reconciliationDecision: "confirmed_not_applied",
                ok: false,
                exitCode: 1,
                stdout: "RAW_REVIEW_SECRET",
              },
            ],
            childTotal: 10,
            childCounts: [
              { status: "failed", count: 1 },
              { status: "completed", count: 9 },
            ],
            childrenTruncated: true,
            children: [
              { id: 102, status: "failed", report: "RAW_CHILD_SECRET" },
            ],
          },
        },
      },
    ]);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
    });
    await page.goto("/projects/101?view=plan");
    const trace = page.getByRole("region", { name: c.title, exact: true });
    const row = trace.getByRole("button", { name: /Original blocked review/ });
    await expect(row).toBeVisible();
    expect(panelRequests).toHaveLength(0);
    await row.focus();
    await row.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const panel = trace.getByRole("region", {
      name: `${r.title} #44`,
      exact: true,
    });
    await expect(panel.getByText(r.help, { exact: true })).toBeVisible();
    expect(panelRequests).toHaveLength(1);
    await expect(panel.getByText(r.countsHelp, { exact: true })).toBeVisible();
    await expect(
      panel.getByText(r.approvedAction, { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText(r.confirmedNotApplied, { exact: true }),
    ).toBeVisible();
    const number = (value: number) =>
      new Intl.NumberFormat(locale).format(value);
    const limit = (shown: number, total: number) =>
      r.limited
        .replace("{shown}", number(shown))
        .replace("{total}", number(total));
    await expect(panel.getByText(limit(1, 14), { exact: true })).toBeVisible();
    await expect(panel.getByText(limit(1, 10), { exact: true })).toBeVisible();
    expect(await panel.textContent()).not.toMatch(
      /RAW_REVIEW_SECRET|RAW_CHILD_SECRET/,
    );
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const download = page.waitForEvent("download");
    await trace.getByRole("button", { name: c.export, exact: true }).click();
    const file = await download;
    const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
    expect(payload.events[0].completionReview).toMatchObject({
      cycleNumber: 0,
      receiptTotal: 14,
      childTotal: 10,
      receiptsTruncated: true,
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /RAW_REVIEW_SECRET|RAW_CHILD_SECRET/,
    );
    if (locale === "en" || locale === "ar") {
      await panel.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: info.outputPath(`review-${locale}.png`) });
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(panel).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      expect(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await row.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "false");
  });
  test(
    locale + " activity and delegation records preserve evidence on mobile",
    async ({ page }, info) => {
      const c = await loadTraceCopy(locale),
        studio = await loadProjectStudioCopy(locale);
      const requested: string[] = [];
      page.on("request", (r) => {
        const file = new URL(r.url()).pathname.split("/").at(-1) ?? "";
        if (/^trace-(tr|en|de|ru|zh-CN|zh-TW|ar)-.+\.js$/.test(file))
          requested.push(file);
      });
      const harness = await setup(page, locale);
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.emulateMedia({
        colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
      });
      await page.goto("/projects/101?view=plan");
      const region = page.getByRole("region", { name: c.title, exact: true });
      await expect(
        region.getByRole("heading", { name: c.title, exact: true }),
      ).toBeVisible();
      await expect(
        region.getByText(c.markedCompleted, { exact: true }),
      ).toBeVisible();
      await expect(region.getByText(c.missing, { exact: true })).toHaveCount(3);
      await expect(region.getByText("configured-only-model")).toHaveCount(0);
      await expect(
        region.getByText("FOREIGN_TASK_MUST_NOT_APPEAR"),
      ).toHaveCount(0);
      const row = region.getByRole("button", {
        name: /Original tool selection summary/,
      });
      await row.focus();
      await row.press("Enter");
      await expect(row).toHaveAttribute("aria-expanded", "true");
      await expect(region.getByText(c.no, { exact: true })).toBeVisible();
      await expect(
        region.getByText("https://example.com/report", { exact: true }),
      ).toBeVisible();
      await region.getByRole("button", { name: c.issues, exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect(
        region.getByText("https://example.com/report", { exact: true }),
      ).toHaveCount(0);
      await region.getByRole("button", { name: c.all, exact: true }).click();
      expect(
        (await region
          .getByRole("button", { name: c.all, exact: true })
          .boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      const downloaded = page.waitForEvent("download");
      await region.getByRole("button", { name: c.export, exact: true }).click();
      const file = await downloaded;
      const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
      expect(payload.boundary).toMatchObject({
        taskId: 101,
        fullHistory: false,
        receipts: false,
        limit: 200,
        refreshFailed: false,
      });
      expect(payload.task).toMatchObject({
        stepCounter: 7,
        lastRecordedModel: null,
      });
      expect(payload.task).not.toHaveProperty("attemptId");
      expect(JSON.stringify(payload)).not.toMatch(
        /SECRET|PRIVATE_PROMPT|FOREIGN_TASK/,
      );
      const evidenceDownload = page.waitForEvent("download");
      await region
        .getByRole("button", { name: c.evidenceExport, exact: true })
        .click();
      const evidenceFile = await evidenceDownload;
      const evidence = JSON.parse(
        await readFile((await evidenceFile.path())!, "utf8"),
      );
      expect(evidence.boundary).toMatchObject({
        taskId: 101,
        fullHistory: false,
        receipts: false,
        pageNumber: 1,
      });
      const { integrity, ...evidenceBody } = evidence;
      expect(integrity).toEqual({
        algorithm: "SHA-256",
        digest: createHash("sha256")
          .update(JSON.stringify(evidenceBody))
          .digest("hex"),
      });
      expect(JSON.stringify(evidence)).not.toMatch(
        /Original|SECRET|PRIVATE_PROMPT|FOREIGN_TASK|Saved task brief/,
      );
      if (locale === "en" || locale === "ar") {
        await row.click();
        await row.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("trace-" + locale + ".png"),
        });
      }
      await page
        .getByRole("tab", { name: studio.teamTab, exact: true })
        .click();
      const delegation = page.getByRole("region", {
        name: c.delegations,
        exact: true,
      });
      await expect(
        delegation.getByText("Original delegation brief", { exact: true }),
      ).toBeVisible();
      await expect(
        delegation.getByText("Original child note 102", { exact: true }),
      ).toBeVisible();
      await expect(delegation.getByText("FOREIGN_CHILD_NOTE")).toHaveCount(0);
      expect(harness.state.childCalls.every((id) => id === 102)).toBe(true);
      const picker = delegation.getByRole("combobox", {
        name: c.delegations,
        exact: true,
      });
      await picker.selectOption("103");
      await expect(
        delegation.getByText("Original child note 103", { exact: true }),
      ).toBeVisible();
      await expect(
        delegation.getByText("Original child note 102", { exact: true }),
      ).toHaveCount(0);
      expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (locale === "en" || locale === "ar") {
        await picker.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("delegation-" + locale + ".png"),
        });
      }
      expect(requested).toHaveLength(1);
      expect(requested[0]).toMatch(new RegExp("^trace-" + locale + "-"));
      expect([...harness.unexpected]).toEqual([]);
    },
  );
}
test("review asset failures retain activity controls and reload cleanly", async ({
  page,
}) => {
  const c = await loadTraceCopy("en");
  await setup(page, "en", [
    {
      id: 44,
      agentId: 1,
      taskId: 101,
      type: "judge_review",
      summary: "Original blocked review",
      severity: "warning",
      createdAt: date,
      detail: {
        completionEvidence: {
          source: "persisted_runtime_metadata",
          taskId: 101,
          cycleNumber: 0,
          receiptTotal: 0,
          receiptCounts: [],
          receiptsTruncated: false,
          receipts: [],
          childTotal: 0,
          childCounts: [],
          childrenTruncated: false,
          children: [],
        },
      },
    },
  ]);
  await page.route("**/assets/completion-review-panel-*.js", (route) =>
    route.abort("failed"),
  );
  await page.goto("/projects/101?view=plan");
  const trace = page.getByRole("region", { name: c.title, exact: true });
  await trace.getByRole("button", { name: /Original blocked review/ }).click();
  await expect(
    trace.getByText("Review details could not be loaded. Reload to retry.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    trace.getByRole("button", { name: c.export, exact: true }),
  ).toBeEnabled();
  await page.unroute("**/assets/completion-review-panel-*.js");
  await trace.getByRole("button", { name: c.retry, exact: true }).click();
  await trace.getByRole("button", { name: /Original blocked review/ }).click();
  await expect(
    trace.getByText(c.reviewEvidence.empty, { exact: true }),
  ).toBeVisible();
});

test("stale activity and delegation snapshots remain usable and explicitly recover", async ({
  page,
}) => {
  const c = await loadTraceCopy("en"),
    studio = await loadProjectStudioCopy("en");
  const harness = await setup(page, "en");
  await page.goto("/projects/101?view=plan");
  const trace = page.getByRole("region", { name: c.title, exact: true });
  await expect(
    trace.getByRole("button", { name: /Original error summary/ }),
  ).toBeVisible();
  harness.state.fail = true;
  await expect(trace.getByText(c.stale, { exact: true })).toBeVisible({
    timeout: 18000,
  });
  await expect(
    trace.getByRole("button", { name: /Original error summary/ }),
  ).toBeVisible();
  harness.state.fail = false;
  await trace.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(trace.getByText(c.stale, { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: studio.teamTab, exact: true }).click();
  const delegation = page.getByRole("region", {
    name: c.delegations,
    exact: true,
  });
  await expect(
    delegation.getByText("Original child note 102", { exact: true }),
  ).toBeVisible();
  harness.state.childFail = true;
  await expect(delegation.getByText(c.stale, { exact: true })).toBeVisible({
    timeout: 18000,
  });
  await expect(
    delegation.getByText("Original child note 102", { exact: true }),
  ).toBeVisible();
  harness.state.childFail = false;
  await delegation.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(delegation.getByText(c.stale, { exact: true })).toHaveCount(0);
});
test("unavailable records are not presented as an empty known history", async ({
  page,
}) => {
  const c = await loadTraceCopy("en");
  const harness = await setup(page, "en");
  harness.state.fail = true;
  await page.goto("/projects/101?view=plan");
  const trace = page.getByRole("region", { name: c.title, exact: true });
  await expect(trace.getByText(c.error, { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(trace.getByText(c.empty, { exact: true })).toHaveCount(0);
  await expect(trace.getByText(c.missing, { exact: true })).toHaveCount(0);
  await expect(
    trace.getByRole("button", { name: c.export, exact: true }),
  ).toBeDisabled();
});

test("trace language asset failure recovers through a fresh document load", async ({
  page,
}) => {
  const c = await loadTraceCopy("en");
  await setup(page, "en");
  await page.route("**/assets/trace-en-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/projects/101?view=plan&keep=1");
  const panel = page.locator("#project-workbench-plan");
  await expect(panel.getByRole("alert")).toContainText("language");
  await page.unroute("**/assets/trace-en-*.js");
  await panel.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: c.title, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/view=plan&keep=1/);
});

const eventKinds = [
  "runtime_registered",
  "runtime_state_changed",
  "attempt_created",
  "attempt_state_changed",
  "receipt_reserved",
  "receipt_state_changed",
  "invocation_created",
  "invocation_state_changed",
  "recovery_recorded",
  "runtime_control_changed",
  "reconciliation_recorded",
  "health_sample_recorded",
];
const registeredLabel = {
  tr: "Çalışma süreci kaydedildi",
  en: "Runtime registered",
  de: "Laufzeit registriert",
  ru: "Рабочий процесс зарегистрирован",
  "zh-CN": "运行进程已注册",
  "zh-TW": "執行程序已註冊",
  ar: "تم تسجيل عملية التشغيل",
};
for (const locale of LOCALES) {
  test(`${locale} authored operations summaries translate while trace exports preserve source`, async ({
    page,
  }) => {
    const c = await loadTraceCopy(locale);
    const events = eventKinds.map((kind, index) => ({
      ...activity[0],
      id: 500 + index,
      type: "operations_changed",
      summary: `STORED_GENERIC_${kind}`,
      detail: { schemaVersion: 1, kind },
    }));
    const literal = "  Original {kind} $&\n\n  原文 نص عربي  ";
    const ordinary = {
      ...activity[0],
      id: 600,
      summary: literal,
      detail: null,
    };
    await setup(page, locale, [...events, ordinary] as typeof activity);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.goto("/projects/101?view=plan");
    const region = page.getByRole("region", { name: c.title, exact: true });
    await expect(
      region.getByText(registeredLabel[locale], { exact: true }),
    ).toBeVisible();
    await expect(region.getByText(/STORED_GENERIC_/)).toHaveCount(0);
    await expect(region.getByText(literal, { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await region.getByRole("button", { name: c.export, exact: true }).click();
    const file = await download;
    const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
    for (const row of events)
      expect(JSON.stringify(payload)).toContain(row.summary);
    expect(JSON.stringify(payload)).toContain(
      JSON.stringify(literal).slice(1, -1),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  });
}
