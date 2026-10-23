import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import { loadResultFormatCopy } from "../../artifacts/agentic-company-os/src/lib/task-result-format-copy";

// Rendering/recovery fixtures do not certify model output or execution.
for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const)
    test(`${locale} ${mode} table headings survive 320px editing, reload and a lost acknowledgement`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.addInitScript(
        ({ locale, mode }) => {
          localStorage.setItem("acos.locale.v1", locale);
          localStorage.setItem("acos.color-mode.v2", mode);
        },
        { locale, mode },
      );
      const fixture = await installStudioFixtures(page);
      await page.route("**/api/task-creation-requests/*", (r) =>
        r.fulfill({
          status: 404,
          json: { code: "TASK_CREATION_REQUEST_NOT_FOUND" },
        }),
      );
      const c = await loadResultFormatCopy(locale),
        form = await loadNewProjectCopy(locale);
      await page.goto("/projects/new");
      const picker = page.getByRole("region", { name: c.title, exact: true });
      const select = picker.getByRole("combobox");
      await expect(select).toHaveValue("plain");
      await select.selectOption("table");
      await expect(picker.getByRole("textbox")).toHaveCount(3);
      for (const [index, heading] of c.defaults.entries())
        await expect(picker.getByRole("textbox").nth(index)).toHaveValue(
          heading,
        );
      await picker.getByRole("textbox").first().fill("");
      await page
        .getByRole("textbox", { name: form.projectName, exact: true })
        .fill("Held meeting actions");
      await page
        .getByRole("textbox", { name: form.brief, exact: true })
        .fill(
          "Read the owned meeting notes and extract only the recorded actions.",
        );
      await expect(picker.getByRole("alert")).toHaveText(c.invalid);
      await expect(
        page.getByRole("button", { name: form.start, exact: true }),
      ).toBeDisabled();
      await page.reload();
      await expect(picker.getByRole("textbox").first()).toHaveValue("");
      await expect(picker.getByRole("alert")).toHaveText(c.invalid);
      const special = "Owner | جهة 😀";
      await picker.getByRole("textbox").first().fill(special);
      await expect(picker.getByRole("alert")).toHaveCount(0);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const control of await picker.locator("input,select,button").all()) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      for (const remove of await picker
        .getByRole("button", { name: new RegExp(c.remove) })
        .all())
        expect((await remove.boundingBox())?.width).toBeGreaterThanOrEqual(160);
      await picker.screenshot({
        path: info.outputPath("selected-result-format.png"),
      });
      await page.getByRole("button", { name: form.start, exact: true }).click();
      await expect.poll(() => fixture.requests.length).toBe(1);
      expect(fixture.requests[0].body).toMatchObject({
        resultFormat: {
          kind: "table",
          columns: [special, ...c.defaults.slice(1)],
        },
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

test("removing an explicit layout requires a deliberate choice and does not leave a hidden contract", async ({
  page,
}) => {
  const fixture = await installStudioFixtures(page);
  const c = await loadResultFormatCopy("tr"),
    form = await loadNewProjectCopy("tr");
  await page.goto("/projects/new");
  const picker = page.getByRole("region", { name: c.title, exact: true });
  await picker.getByRole("combobox").selectOption("table");
  await picker.getByRole("button", { name: c.add, exact: true }).click();
  await expect(picker.getByRole("textbox")).toHaveCount(4);
  await picker.getByRole("textbox").last().fill(c.defaults[0]);
  await expect(picker.getByRole("alert")).toHaveText(c.invalid);
  await picker.getByRole("combobox").selectOption("plain");
  await expect(picker.getByRole("textbox")).toHaveCount(0);
  await expect(picker.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: form.projectName, exact: true })
    .fill("Plain task");
  await page
    .getByRole("textbox", { name: form.brief, exact: true })
    .fill("Return a concise answer.");
  await page.getByRole("button", { name: form.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].body).not.toHaveProperty("resultFormat");
  expect([...fixture.unexpected]).toEqual([]);
});

async function savedLayoutTask(page: Page, columns: string[]) {
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
    resultFormat: { kind: "table", columns },
    completionRequirements: [],
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

for (const locale of ["en", "ar"] as const)
  test(`${locale} saved layout is visible and reused without starting work`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(
      (locale) => localStorage.setItem("acos.locale.v1", locale),
      locale,
    );
    const columns = ["Owner | جهة", "Action", "Date 😀"];
    const fixture = await savedLayoutTask(page, columns);
    const c = await loadResultFormatCopy(locale);
    const { loadReusableWorkCopy } =
      await import("../../artifacts/agentic-company-os/src/lib/reusable-work-copy");
    const reuse = await loadReusableWorkCopy(locale);
    await page.goto("/projects/101");
    const panel = page.getByRole("region", { name: c.saved, exact: true });
    await expect(panel).toBeVisible();
    for (const heading of columns)
      await expect(panel.getByText(heading, { exact: true })).toBeVisible();
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    await page
      .getByRole("button", { name: reuse.useBrief, exact: true })
      .click();
    await expect(page).toHaveURL(/\/projects\/new$/u);
    const picker = page.getByRole("region", { name: c.title, exact: true });
    await expect(picker.getByRole("combobox")).toHaveValue("table");
    for (const [index, heading] of columns.entries())
      await expect(picker.getByRole("textbox").nth(index)).toHaveValue(heading);
    expect(fixture.requests).toHaveLength(0);
    expect([...fixture.unexpected]).toEqual([]);
  });
