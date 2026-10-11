import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import {
  LOCALES,
  setupMessages,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import { loadCompletionRequirementsCopy } from "../../artifacts/agentic-company-os/src/lib/completion-requirements-copy";

// Browser fixtures prove rendering, input/recovery and privacy projection. Real
// PostgreSQL/API/worker tests separately prove execution admission and fencing.
for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const) {
    test(`${locale} ${mode} mobile conditions survive keyboard selection, reload and unknown submission`, async ({
      page,
    }, info) => {
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.addInitScript(
        ({ locale, mode }) => {
          localStorage.setItem("acos.locale.v1", locale);
          localStorage.setItem("acos.color-mode.v2", mode);
        },
        { locale, mode },
      );
      const fixture = await installStudioFixtures(page);
      await page.route("**/api/task-completion-tools", (r) =>
        r.fulfill({
          json: { ownerAgentId: 1, tools: ["calculate", "vm_read_file"] },
        }),
      );
      await page.route("**/api/task-creation-requests/*", (r) =>
        r.fulfill({
          status: 404,
          json: { code: "TASK_CREATION_REQUEST_NOT_FOUND" },
        }),
      );
      const c = await loadCompletionRequirementsCopy(locale),
        form = await loadNewProjectCopy(locale);
      await page.goto("/projects/new");
      const summary = page
        .locator("details summary")
        .filter({ hasText: c.title });
      await summary.focus();
      await summary.press("Enter");
      const picker = summary.locator("..");
      const checkbox = picker.locator('input[type="checkbox"]').first();
      await expect(checkbox).toBeVisible();
      await checkbox.focus();
      await checkbox.press("Space");
      await expect(checkbox).toBeChecked();
      await expect(
        picker.getByRole("region", { name: c.selected }),
      ).toContainText(c.labels.calculate);
      await page
        .getByRole("textbox", { name: form.projectName, exact: true })
        .fill("Preserve the actual operation");
      await page
        .getByRole("textbox", { name: form.brief, exact: true })
        .fill("Use calculate for 17 × 23, then review the result.");
      await page.reload();
      await expect(
        picker.locator('input[type="checkbox"]').first(),
      ).toBeChecked();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const selected = picker.getByRole("region", { name: c.selected });
      await selected.screenshot({
        path: info.outputPath("selected-conditions.png"),
      });
      await page.getByRole("button", { name: form.start, exact: true }).click();
      await expect.poll(() => fixture.requests.length).toBe(1);
      expect(fixture.requests[0].body).toMatchObject({
        completionRequirements: [{ kind: "tool_succeeded", tool: "calculate" }],
      });
      const saved = await page.evaluate(() =>
        sessionStorage.getItem("acos.project-start.v1"),
      );
      expect(saved).not.toBeNull();
      await page.reload();
      await expect(
        page.getByRole("button", { name: form.start, exact: true }),
      ).toBeDisabled();
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("acos.project-start.v1"),
        ),
      ).toBe(saved);
      expect(fixture.requests).toHaveLength(1);
      expect([...fixture.unexpected]).toEqual([]);
    });
  }

test("failed or changed catalog keeps selected conditions visible and requires deliberate removal before start", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const fixture = await installStudioFixtures(page),
    c = await loadCompletionRequirementsCopy("en"),
    form = await loadNewProjectCopy("en");
  let phase = "ready";
  await page.route("**/api/task-completion-tools", (r) =>
    r.fulfill({
      status: phase === "error" ? 503 : 200,
      json:
        phase === "error"
          ? { privateError: "PRIVATE_RESULT" }
          : { ownerAgentId: 1, tools: phase === "ready" ? ["calculate"] : [] },
    }),
  );
  await page.goto("/projects/new");
  await page.locator("details summary").filter({ hasText: c.title }).click();
  const picker = page.locator("details");
  await picker.getByRole("checkbox").check();
  await page
    .getByRole("textbox", { name: form.projectName, exact: true })
    .fill("My job");
  await page
    .getByRole("textbox", { name: form.brief, exact: true })
    .fill("Must use calculate.");
  phase = "error";
  await picker.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(picker.getByRole("alert")).toHaveText(c.loadError);
  await expect(picker.getByRole("region", { name: c.selected })).toContainText(
    c.labels.calculate,
  );
  await expect(
    page.getByRole("button", { name: form.start, exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("PRIVATE_RESULT", { exact: false })).toHaveCount(
    0,
  );
  phase = "removed";
  await picker.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(picker.getByText(c.unavailable)).toBeVisible();
  await expect(
    page.getByRole("button", { name: form.start, exact: true }),
  ).toBeDisabled();
  await picker
    .getByRole("button", {
      name: `${c.remove}: ${c.labels.calculate}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: form.start, exact: true }),
  ).toBeEnabled();
  expect(fixture.requests).toHaveLength(0);
  expect([...fixture.unexpected]).toEqual([]);
});

async function savedTask(page: Page) {
  const fixture = await installStudioFixtures(page);
  const project = {
    id: 101,
    title: "Operation required",
    brief: "Calculate 17 × 23.",
    status: "in_progress",
    priority: "normal",
    ownerAgentId: 1,
    assignedByAgentId: null,
    createdByUser: true,
    parentTaskId: null,
    progressPercent: 10,
    tokensUsed: 0,
    estimatedCostUsd: null,
    resultSummary: null,
    executionModelId: null,
    lastModelId: null,
    lastModelProvider: null,
    modelFallbackCount: 0,
    autonomyMode: "continuous",
    cadenceSeconds: 3600,
    lastHeartbeatAt: null,
    recoveryCount: 0,
    cycleCount: 2,
    lastCycleCompletedAt: null,
    lastSteppedAt: null,
    stepAttempts: 0,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    lastError: null,
    blockedReason: null,
    dueAt: null,
    createdAt: "2026-10-11T01:00:00Z",
    updatedAt: "2026-10-11T01:00:00Z",
    completedAt: null,
    completionRequirements: [{ kind: "tool_succeeded", tool: "calculate" }],
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
  return fixture;
}

for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const) {
    test(`${locale} ${mode} mobile task shows fresh success separately from permission loss and answer quality`, async ({
      page,
    }, info) => {
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.addInitScript(
        ({ locale, mode }) => {
          localStorage.setItem("acos.locale.v1", locale);
          localStorage.setItem("acos.color-mode.v2", mode);
        },
        { locale, mode },
      );
      const fixture = await savedTask(page),
        c = await loadCompletionRequirementsCopy(locale);
      let satisfied = false;
      await page.route("**/api/tasks/101/completion-requirements", (r) =>
        r.fulfill({
          json: {
            source: "persisted_current_cycle",
            taskId: 101,
            cycleNumber: 2,
            taskStatus: "in_progress",
            observedAt: "2026-10-11T01:01:00Z",
            requirements: [
              {
                kind: "tool_succeeded",
                tool: "calculate",
                satisfied,
                available: false,
              },
            ],
          },
        }),
      );
      await page.goto("/projects/101");
      const panel = page.getByRole("region", { name: c.title, exact: true });
      await expect(panel.getByText(c.missing, { exact: true })).toBeVisible();
      await expect(
        panel.getByText(c.unavailableActive, { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByText(c.sourceHelp, { exact: true }),
      ).toBeVisible();
      satisfied = true;
      await panel.getByRole("button", { name: c.retry, exact: true }).click();
      await expect(panel.getByText(c.satisfied, { exact: true })).toBeVisible();
      await expect(
        panel.getByText(c.unavailableActive, { exact: true }),
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await panel.screenshot({
        path: info.outputPath("current-cycle-conditions.png"),
      });
      expect(fixture.requests).toHaveLength(0);
      expect([...fixture.unexpected]).toEqual([]);
    });
  }

test("a failed or foreign condition snapshot cannot keep advertising a stale success", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await savedTask(page);
  const c = await loadCompletionRequirementsCopy("en");
  let phase = "ready";
  await page.route("**/api/tasks/101/completion-requirements", (r) =>
    r.fulfill({
      status: phase === "error" ? 503 : 200,
      json:
        phase === "error"
          ? { output: "PRIVATE_OUTPUT" }
          : {
              source: "persisted_current_cycle",
              taskId: phase === "foreign" ? 102 : 101,
              cycleNumber: 2,
              taskStatus: "in_progress",
              observedAt: "2026-10-11T01:01:00Z",
              requirements: [
                {
                  kind: "tool_succeeded",
                  tool: "calculate",
                  satisfied: true,
                  available: true,
                },
              ],
            },
    }),
  );
  await page.goto("/projects/101");
  const panel = page.getByRole("region", { name: c.title, exact: true });
  await expect(panel.getByText(c.satisfied, { exact: true })).toBeVisible();
  for (phase of ["error", "foreign"]) {
    await panel.getByRole("button", { name: c.retry, exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText(c.loadError);
    await expect(panel.getByText(c.satisfied, { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("PRIVATE_OUTPUT", { exact: false }),
    ).toHaveCount(0);
  }
});

test("a condition rejected during admission can be explicitly prepared again without reusing the rejected identity", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const fixture = await installStudioFixtures(page),
    c = await loadCompletionRequirementsCopy("en"),
    form = await loadNewProjectCopy("en");
  let allowed = true;
  const posts: Array<{ requestId: string; completionRequirements?: unknown }> =
    [];
  await page.route("**/api/task-completion-tools", (r) =>
    r.fulfill({
      json: { ownerAgentId: 1, tools: allowed ? ["calculate"] : [] },
    }),
  );
  await page.route("**/api/tasks", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posts.push(r.request().postDataJSON());
    allowed = false;
    return r.fulfill({
      status: posts.length === 1 ? 423 : 503,
      json: { code: "EXECUTION_POLICY_DENIED" },
    });
  });
  await page.route("**/api/task-creation-requests/*", (r) =>
    posts.length === 1
      ? r.fulfill({
          json: {
            requestId: posts[0].requestId,
            state: "rejected",
            taskId: null,
            failureCode: "EXECUTION_POLICY_DENIED",
            createdAt: "2026-10-11T01:00:00Z",
          },
        })
      : r.fulfill({
          status: 404,
          json: { code: "TASK_CREATION_REQUEST_NOT_FOUND" },
        }),
  );
  await page.goto("/projects/new");
  await page.locator("details summary").filter({ hasText: c.title }).click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("textbox", { name: form.projectName, exact: true })
    .fill("Explicit operation");
  await page
    .getByRole("textbox", { name: form.brief, exact: true })
    .fill("Use calculate.");
  await page.getByRole("button", { name: form.start, exact: true }).click();
  const prepare = page.getByRole("button", {
    name: form.recovery.prepare,
    exact: true,
  });
  await page
    .getByRole("button", { name: form.recovery.check, exact: true })
    .click();
  await expect(prepare).toBeVisible();
  await prepare.click();
  const picker = page.locator("details");
  await picker.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(picker.getByText(c.unavailable, { exact: true })).toBeVisible();
  await picker
    .getByRole("button", {
      name: `${c.remove}: ${c.labels.calculate}`,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: form.start, exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].requestId).not.toBe(posts[0].requestId);
  expect(posts[1].completionRequirements).toBeUndefined();
  expect(fixture.requests).toHaveLength(0);
  expect([...fixture.unexpected]).toEqual([]);
});

for (const refuseSave of [false, true])
  test(`condition language recovery preserves draft and selections when storage refusal is ${refuseSave}`, async ({
    page,
  }) => {
    const initial = {
      version: 1,
      kind: "project",
      title: "My original title",
      brief: "My original brief",
      priority: "normal",
      autonomyMode: "finite",
      cadenceSeconds: 3600,
      completionRequirements: [{ kind: "tool_succeeded", tool: "calculate" }],
    };
    await page.addInitScript((value) => {
      localStorage.setItem("acos.locale.v1", "en");
      if (!sessionStorage.getItem("acos.composer-draft.v1:project"))
        sessionStorage.setItem(
          "acos.composer-draft.v1:project",
          JSON.stringify(value),
        );
    }, initial);
    const fixture = await installStudioFixtures(page),
      form = await loadNewProjectCopy("en"),
      c = await loadCompletionRequirementsCopy("en");
    await page.route("**/api/task-completion-tools", (r) =>
      r.fulfill({ json: { ownerAgentId: 1, tools: ["calculate"] } }),
    );
    let fail = true;
    await page.route("**/assets/requirements-en-*.js", (r) =>
      fail ? r.abort("failed") : r.continue(),
    );
    await page.goto("/projects/new");
    const alert = page
      .getByRole("alert")
      .filter({ hasText: setupMessages.en.languageFileError });
    await expect(alert).toBeVisible();
    if (refuseSave)
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (
            this === sessionStorage &&
            key === "acos.composer-draft.v1:project"
          )
            throw Error("Test storage refusal");
          return original.call(this, key, value);
        };
      });
    await page
      .getByRole("textbox", { name: form.brief, exact: true })
      .fill("Keep this later edit too.");
    fail = false;
    await alert.getByRole("button").click();
    if (refuseSave) {
      await expect(alert).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: form.brief, exact: true }),
      ).toHaveValue("Keep this later edit too.");
      expect(
        JSON.parse(
          (await page.evaluate(() =>
            sessionStorage.getItem("acos.composer-draft.v1:project"),
          ))!,
        ).brief,
      ).toBe("My original brief");
    } else {
      await expect(
        page.locator("details summary").filter({ hasText: c.title }),
      ).toBeVisible();
      await expect(page.getByRole("checkbox")).toBeChecked();
      await expect(
        page.getByRole("textbox", { name: form.brief, exact: true }),
      ).toHaveValue("Keep this later edit too.");
    }
    expect(fixture.requests).toHaveLength(0);
    expect([...fixture.unexpected]).toEqual([]);
  });
