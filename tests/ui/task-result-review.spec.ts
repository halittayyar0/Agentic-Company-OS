import { expect, test, type Page } from "@playwright/test";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadApprovalCopy } from "../../artifacts/agentic-company-os/src/lib/approval-copy";
import { loadDeliveryDownloadCopy } from "../../artifacts/agentic-company-os/src/lib/delivery-download-copy";
import { loadTaskResultReviewCopy } from "../../artifacts/agentic-company-os/src/lib/task-result-review-copy";
import { installStudioFixtures } from "./helpers/studio-fixtures";
const hash = "a".repeat(64);
async function setup(page: Page, locale: Locale = "en") {
  await page.addInitScript(
    (locale) => localStorage.setItem("acos.locale.v1", locale),
    locale,
  );
  const fixture = await installStudioFixtures(page);
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const approval = {
    id: 21,
    taskId: 7,
    agentId: 1,
    category: "other",
    title: "Held fictional notes",
    description: "Original proposal",
    status: "pending",
    amountUsd: null,
    decisionNote: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    consumedAt: null,
    expiresAt: expiry,
    scope: {
      toolName: "operator_confirm_task_result",
      argsHash: hash,
      preview: "Server result review",
    },
    resultReview: {
      kind: "task_result",
      proposalHash: hash,
      cycleNumber: 2,
      available: true,
    },
  };
  const state = {
    approval,
    authenticated: true,
    enabled: true,
    malformed: false,
    failed: false,
    stopped: false,
    listError: false,
    reads: 0,
    decisions: [] as Record<string, unknown>[],
    proposed: {
      approvalId: 21,
      taskId: 7,
      cycleNumber: 2,
      proposalHash: hash,
      resultSummary:
        "| Owner | Action | Date |\n| --- | --- | --- |\n| Mira | Review <script>alert(1)</script> | 2026-10-26 |\n\nLaunch remains undecided.",
      resultFormat: { kind: "table", columns: ["Owner", "Action", "Date"] },
      judgeReasonCode: "missing_required_action",
      expiresAt: expiry,
      requirements: [
        {
          kind: "tool_succeeded",
          tool: "vm_read_file",
          satisfied: true,
          available: true,
        },
      ],
    },
  };
  await page.route("**/api/auth/status", (r) =>
    r.fulfill({
      json: {
        enabled: state.enabled,
        authenticated: state.authenticated,
        sessionExpiresAt: null,
      },
    }),
  );
  await page.route("**/api/ops/control", (r) =>
    r.fulfill({
      json: {
        emergencyStopEnabled: state.stopped,
        reason: null,
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: "test",
        blockedScopes: [],
      },
    }),
  );
  await page.route("**/api/approvals?*", (r) =>
    r.fulfill({
      status: state.listError ? 503 : 200,
      json: state.listError ? { error: "Unavailable" } : [state.approval],
    }),
  );
  await page.route("**/api/approvals/21/result-review", (r) => {
    state.reads++;
    return r.fulfill({
      json: state.malformed
        ? { ...state.proposed, proposalHash: "b".repeat(64) }
        : state.proposed,
    });
  });
  await page.route("**/api/approvals/21/decision", (r) => {
    const body = r.request().postDataJSON();
    state.decisions.push(body);
    if (state.failed)
      return r.fulfill({ status: 503, json: { error: "Unconfirmed" } });
    state.approval.status = body.decision;
    state.approval.consumedAt =
      body.decision === "approved" ? new Date().toISOString() : null;
    return r.fulfill({ json: state.approval });
  });
  return {
    state,
    fixture,
    c: await loadTaskResultReviewCopy(locale),
    a: await loadApprovalCopy(locale),
  };
}

for (const locale of LOCALES)
  test(`${locale}: exact operator result review fits 320px and confirms with explicit authority`, async ({
    page,
  }, info) => {
    const { state, fixture, c, a } = await setup(page, locale);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    await page.goto("/approvals");
    const open = page.getByRole("button", {
      name: a.reviewResult,
      exact: true,
    });
    await expect(open).toBeVisible();
    expect(state.reads).toBe(0);
    await expect(
      page.getByRole("button", { name: a.approve, exact: true }),
    ).toHaveCount(0);
    await open.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: c.title, exact: true });
    await expect(
      page.getByText("operator_confirm_task_result", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(a.source, { exact: true })).toHaveCount(0);
    await expect(page.getByText(a.scope, { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("table")).toBeVisible();
    await expect(
      panel.getByRole("cell", {
        name: "Review <script>alert(1)</script>",
        exact: true,
      }),
    ).toBeVisible();
    expect(await panel.locator("script").count()).toBe(0);
    await expect(
      panel.getByText(c.missing_required_action, { exact: true }),
    ).toBeVisible();
    const confirm = panel.getByRole("button", { name: c.confirm, exact: true });
    await expect(confirm).toBeDisabled();
    if (locale === "ar" || locale === "en")
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
    const checkbox = panel.getByRole("checkbox", {
      name: c.acknowledge,
      exact: true,
    });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(confirm).toBeEnabled();
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (locale === "en" || locale === "ar")
      await panel
        .filter({
          has: page.getByRole("heading", { name: c.title, exact: true }),
        })
        .screenshot({
          path: info.outputPath(
            `operator-review-${locale}-320px-200percent.png`,
          ),
        });
    await confirm.click();
    await expect(page.getByText(c.confirmed, { exact: true })).toBeVisible();
    expect(state.decisions).toEqual([
      {
        decision: "approved",
        locale,
        expectedArgsHash: hash,
        confirmTaskResult: true,
      },
    ]);
    expect([...fixture.unexpected]).toEqual([]);
  });

test("disabled credentials do not download, confirm or reject a proposed result", async ({
  page,
}) => {
  const { state, c, a } = await setup(page);
  state.enabled = false;
  await page.goto("/approvals");
  await page.getByRole("button", { name: a.reviewResult, exact: true }).click();
  await expect(page.getByText(c.auth, { exact: true })).toBeVisible();
  expect(state.reads).toBe(0);
  await expect(
    page.getByRole("button", { name: c.confirm, exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: c.reject, exact: true }),
  ).toBeDisabled();
  expect(state.decisions).toEqual([]);
});

test("a marker without result metadata never exposes generic approve", async ({
  page,
}) => {
  const { state, a } = await setup(page);
  delete (state.approval as { resultReview?: unknown }).resultReview;
  await page.goto("/approvals");
  await expect(
    page.getByRole("button", { name: a.reviewResult, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: a.approve, exact: true }),
  ).toHaveCount(0);
});

test("malformed proposal, refresh and uncertain decision all clear acknowledgement", async ({
  page,
}) => {
  const { state, c, a } = await setup(page);
  await page.goto("/approvals");
  await page.getByRole("button", { name: a.reviewResult, exact: true }).click();
  const panel = page.getByRole("region", { name: c.title, exact: true }),
    checkbox = panel.getByRole("checkbox"),
    confirm = panel.getByRole("button", { name: c.confirm, exact: true }),
    refresh = panel.getByRole("button", { name: c.refresh, exact: true });
  await checkbox.check();
  await refresh.click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  state.failed = true;
  await confirm.click();
  await expect(panel.getByText(c.error, { exact: true })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: c.reject, exact: true }),
  ).toBeDisabled();
  state.malformed = true;
  await refresh.click();
  await expect(panel.getByText(c.unavailable, { exact: true })).toBeVisible();
  await expect(confirm).toBeDisabled();
  expect(state.decisions).toHaveLength(1);
});

test("closing, reopening and loss of credential authentication discard full review state", async ({
  page,
}) => {
  const { state, c, a } = await setup(page);
  await page.goto("/approvals");
  const open = page.getByRole("button", { name: a.reviewResult, exact: true });
  await open.click();
  const panel = page.getByRole("region", { name: c.title, exact: true });
  await expect(panel.getByRole("table")).toBeVisible();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: a.cancel, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await open.click();
  await expect(panel.getByRole("table")).toBeVisible();
  expect(state.reads).toBe(2);
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  state.enabled = false;
  await panel.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(panel.getByText(c.auth, { exact: true })).toBeVisible();
  await expect(panel.getByRole("table")).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.stringify(Object.entries(localStorage))),
  ).not.toContain("Review <script>");
  expect(state.decisions).toHaveLength(0);
});

test("safety stop and stale inbox cannot confirm an acknowledged proposal", async ({
  page,
}) => {
  const { state, c, a } = await setup(page);
  state.stopped = true;
  await page.goto("/approvals");
  await page.getByRole("button", { name: a.reviewResult, exact: true }).click();
  const panel = page.getByRole("region", { name: c.title, exact: true });
  await expect(panel.getByRole("table")).toBeVisible();
  await panel.getByRole("checkbox").check();
  await expect(
    panel.getByRole("button", { name: c.confirm, exact: true }),
  ).toBeDisabled();
  await expect(panel.getByText(c.safety, { exact: true })).toBeVisible();
  state.listError = true;
  await page.getByRole("button", { name: a.retry, exact: true }).click();
  await expect(
    panel.getByRole("button", { name: c.confirm, exact: true }),
  ).toBeDisabled();
  expect(state.decisions).toHaveLength(0);
});

for (const locale of ["en", "ar"] as const)
  test(`${locale}: operator provenance survives delivered result reload and download`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (locale) => localStorage.setItem("acos.locale.v1", locale),
      locale,
    );
    const fixture = await installStudioFixtures(page),
      c = await loadTaskResultReviewCopy(locale);
    const project = {
      id: 101,
      title: "Human-confirmed held notes",
      brief: "Read only",
      status: "completed",
      priority: "normal",
      ownerAgentId: 1,
      assignedByAgentId: null,
      createdByUser: true,
      parentTaskId: null,
      progressPercent: 100,
      tokensUsed: 20,
      estimatedCostUsd: null,
      resultSummary: "| Owner | Date |\n| --- | --- |\n| Mira | 2026-10-26 |",
      resultFormat: { kind: "table", columns: ["Owner", "Date"] },
      completionRequirements: [],
      completionAuthority: "operator",
      executionModelId: null,
      lastModelId: null,
      lastModelProvider: null,
      modelFallbackCount: 0,
      autonomyMode: "finite",
      cadenceSeconds: null,
      lastHeartbeatAt: null,
      recoveryCount: 0,
      cycleCount: 0,
      lastCycleCompletedAt: null,
      lastSteppedAt: null,
      stepAttempts: 1,
      consecutiveFailures: 0,
      nextAttemptAt: null,
      lastError: null,
      blockedReason: null,
      dueAt: null,
      createdAt: "2026-10-23T01:00:00Z",
      updatedAt: "2026-10-23T02:00:00Z",
      completedAt: "2026-10-23T02:00:00Z",
    };
    await page.route("**/api/tasks/101", (r) => r.fulfill({ json: project }));
    await page.route(
      /\/api\/tasks\/101\/(subtasks|activity|members)(?:\?|$)/u,
      (r) => r.fulfill({ json: [] }),
    );
    await page.route("**/api/agents/1/messages?**", (r) =>
      r.fulfill({ json: [] }),
    );
    await page.route("**/api/agents/1/vm/status", (r) =>
      r.fulfill({ status: 404, json: { error: "No fixture VM" } }),
    );
    await page.route("**/api/agents/1/browser/view", (r) =>
      r.fulfill({ status: 404, json: { error: "No fixture browser" } }),
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/projects/101");
    const delivery = page.locator("#project-delivery-summary");
    await expect(
      delivery.getByText(c.provenance, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      delivery.getByText(c.provenanceHelp, { exact: true }),
    ).toBeVisible();
    await expect(delivery).not.toContainText("saved by the agent");
    await expect(delivery).not.toContainText("حفظه الوكيل");
    await delivery.screenshot({
      path: info.outputPath(`operator-provenance-${locale}-320px.png`),
    });
    const d = await loadDeliveryDownloadCopy(locale);
    const downloaded = page.waitForEvent("download");
    await delivery
      .getByRole("button", { name: d.downloadDelivery, exact: true })
      .click();
    const download = await downloaded;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain(c.provenanceHelp);
    expect([...fixture.unexpected]).toEqual([]);
  });
