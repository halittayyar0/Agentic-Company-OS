import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadTraceCopy } from "../../artifacts/agentic-company-os/src/lib/trace-copy";
import { loadProjectStudioCopy } from "../../artifacts/agentic-company-os/src/lib/project-studio-copy";
import {
  getToolCopy,
  toolMessage,
} from "../../artifacts/api-server/src/lib/orchestrator/tool-localization";

const timestamp = "2026-09-28T09:00:00.000Z";

for (const locale of LOCALES) {
  test(`${locale} runtime budget and paused recovery remain readable on a phone`, async ({
    page,
  }, info) => {
    const copy = getToolCopy(locale);
    const trace = await loadTraceCopy(locale);
    const studio = await loadProjectStudioCopy(locale);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(
      (language) => localStorage.setItem("acos.locale.v1", language),
      locale,
    );
    await page.emulateMedia({
      colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
    });
    const harness = await installStudioFixtures(page);
    let paused = false;
    let budgetReads = 0;
    const reason = toolMessage(locale, "schedulerCostBudget", {
      used: "1.250000",
      limit: 1,
    });
    const project = () => ({
      id: 101,
      title: "Original project 原文",
      brief: "Original brief {title}",
      status: paused ? "in_progress" : "blocked",
      priority: "normal",
      parentTaskId: null,
      ownerAgentId: 1,
      assignedByAgentId: null,
      createdByUser: true,
      progressPercent: 20,
      tokensUsed: 1500,
      estimatedCostUsd: "1.250000",
      createdAt: timestamp,
      updatedAt: timestamp,
      stepAttempts: 3,
      cycleCount: 0,
      recoveryCount: paused ? 1 : 0,
      consecutiveFailures: 0,
      resultSummary: null,
      lastModelId: null,
      executionModelId: null,
      autonomyMode: "finite",
      cadenceSeconds: null,
      lastError: paused ? copy.schedulerRecoveryPausedNote : reason,
      blockedReason: paused ? null : "budget",
      completedAt: null,
      nextAttemptAt: null,
      lastHeartbeatAt: timestamp,
      dueAt: null,
    });
    await page.route("**/api/tasks/101", (route) =>
      route.fulfill({ json: project() }),
    );
    await page.route("**/api/tasks/101/budget-resume", (route) => {
      // Only the scope read is expected. A mutation still reaches the strict
      // fixture fallback and fails the unexpected-request assertion below.
      if (route.request().method() !== "GET") return route.fallback();
      budgetReads++;
      return route.fulfill({
        json: { taskId: 101, rootTaskId: 101, budgetPaused: !paused },
      });
    });
    await page.route("**/api/tasks/101/members", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/api/tasks/101/subtasks**", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/api/agents/1/messages**", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/api/tasks/101/activity**", (route) =>
      route.fulfill({
        json: [
          {
            id: 77,
            taskId: 101,
            agentId: 1,
            type: paused ? "task_status_changed" : "error",
            summary: paused
              ? copy.schedulerRecoveryPaused
              : toolMessage(locale, "schedulerBudgetStopped", { reason }),
            severity: paused ? "warning" : "critical",
            detail: paused
              ? { reason: "expired_lease", recoveryCount: 1 }
              : { usageSource: "max(task_aggregate,usage_events_ledger)" },
            createdAt: timestamp,
          },
        ],
      }),
    );
    await page.route("**/api/ops/control", (route) =>
      route.fulfill({
        json: {
          emergencyStopEnabled: paused,
          reason: paused ? "Original operator reason 原文" : null,
          version: paused ? 2 : 1,
          updatedBy: "test",
          updatedAt: timestamp,
          blockedScopes: paused
            ? [
                "agent_chat",
                "task_scheduler",
                "agent_tools",
                "approved_actions",
              ]
            : [],
        },
      }),
    );
    for (const state of ["budget", "paused"] as const) {
      paused = state === "paused";
      await page.goto("/projects/101?view=plan");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
      const notice = page.getByText(
        paused ? copy.schedulerRecoveryPausedNote : reason,
        { exact: true },
      );
      await expect(notice).toBeVisible();
      if (state === "budget") {
        await expect.poll(() => budgetReads).toBeGreaterThan(0);
        await expect(
          page.getByRole("button", { name: studio.budgetCheck, exact: true }),
        ).toBeVisible();
      } else {
        await expect(
          page.getByRole("button", { name: studio.budgetCheck, exact: true }),
        ).toHaveCount(0);
      }
      await notice.scrollIntoViewIfNeeded();
      expect(
        await notice.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth + 1 &&
            element.scrollHeight <= element.clientHeight + 1,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${locale}-${state}.png`),
        fullPage: true,
      });
      const records = page.getByRole("region", {
        name: trace.title,
        exact: true,
      });
      await expect(
        records.getByText(
          paused
            ? copy.schedulerRecoveryPaused
            : toolMessage(locale, "schedulerBudgetStopped", { reason }),
          { exact: true },
        ),
      ).toBeVisible();
    }
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  });
}
