import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import {
  LOCALES,
  loadShellMessages,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadTraceCopy } from "../../artifacts/agentic-company-os/src/lib/trace-copy";
import { loadProjectStudioCopy } from "../../artifacts/agentic-company-os/src/lib/project-studio-copy";

const date = "2026-09-28T09:00:00Z";
const project = (id: number) => ({
  id,
  title: `Original project ${id}`,
  brief: `Original brief 原文 ${id}`,
  status: "pending",
  priority: "normal",
  parentTaskId: null,
  ownerAgentId: 1,
  assignedByAgentId: null,
  createdByUser: true,
  progressPercent: 0,
  tokensUsed: 0,
  estimatedCostUsd: null,
  createdAt: date,
  updatedAt: date,
  stepAttempts: 7,
  cycleCount: 2,
  recoveryCount: 0,
  consecutiveFailures: 0,
  resultSummary: null,
  lastModelId: null,
  executionModelId: null,
  autonomyMode: "finite",
  cadenceSeconds: null,
  lastError: null,
  blockedReason: null,
  completedAt: null,
  nextAttemptAt: null,
  lastHeartbeatAt: null,
  dueAt: null,
});

for (const locale of LOCALES)
  test(`${locale} older projects survive a failed continuation and can return to newer and latest records`, async ({
    page,
  }, info) => {
    const c = await loadShellMessages(locale);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
    });
    await page.addInitScript(
      (lang) => localStorage.setItem("acos.locale.v1", lang),
      locale,
    );
    await page.clock.install();
    await installStudioFixtures(page);
    let failOlder = true;
    const cursors: Array<string | null> = [];
    await page.route("**/api/tasks?*", (route) => {
      const cursor = new URL(route.request().url()).searchParams.get(
        "beforeId",
      );
      cursors.push(cursor);
      if (cursor && failOlder)
        return route.fulfill({
          status: 503,
          json: { error: "PRIVATE_FAILURE" },
        });
      return route.fulfill({
        json: cursor ? [project(200)] : [project(202), project(201)],
        headers: cursor ? {} : { "X-Next-Before-Id": "201" },
      });
    });
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: "Original project 202" }),
    ).toBeVisible();
    const pages = page.getByRole("navigation", { name: c.historyPages });
    await expect(
      pages.getByRole("button", { name: c.historyOlder, exact: true }),
    ).toBeVisible();
    await pages
      .getByRole("button", { name: c.historyOlder, exact: true })
      .press("Enter");
    await expect(pages.getByRole("alert")).toBeVisible();
    await expect(
      pages.getByRole("button", { name: c.historyLatest, exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "Original project 202" }),
    ).toBeVisible();
    await expect(page.getByText("PRIVATE_FAILURE")).toHaveCount(0);
    failOlder = false;
    await pages
      .getByRole("button", { name: c.checkAgain, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Original project 200" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Original project 202" }),
    ).toHaveCount(0);
    await expect(
      pages.getByRole("button", { name: c.historyOlder, exact: true }),
    ).toBeDisabled();
    const reads = cursors.length;
    await page.clock.fastForward(15_000);
    expect(cursors).toHaveLength(reads);
    await expect(
      pages.getByText(c.historyPaused, { exact: true }),
    ).toBeVisible();
    const newer = pages.getByRole("button", {
      name: c.historyNewer,
      exact: true,
    });
    expect((await newer.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (locale === "en" || locale === "ar")
      await pages.screenshot({
        path: info.outputPath(`history-${locale}.png`),
      });
    await pages
      .getByRole("button", { name: c.historyNewer, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Original project 202" }),
    ).toBeVisible();
    await pages
      .getByRole("button", { name: c.historyOlder, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Original project 200" }),
    ).toBeVisible();
    await pages
      .getByRole("button", { name: c.historyLatest, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Original project 202" }),
    ).toBeVisible();
    expect(cursors.filter((value) => value === "201")).toHaveLength(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

const activity = (id: number, taskId = 101) => ({
  id,
  taskId,
  agentId: 1,
  type: "note",
  summary: `Original activity 原文 ${id}`,
  severity: "info",
  detail: null,
  createdAt: date,
});
async function projectSetup(page: Page) {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({ json: project(101) }),
  );
  await page.route("**/api/tasks/101/members", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/tasks/101/subtasks**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/tasks/101/activity**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/agents/1/messages**", (route) =>
    route.fulfill({ json: [] }),
  );
  return harness;
}

test("trace exports exactly the selected page and retains current task facts while newest polling continues elsewhere", async ({
  page,
}) => {
  await page.clock.install();
  await projectSetup(page);
  const c = await loadTraceCopy("en");
  let newest = 300;
  await page.route("**/api/tasks/101/activity**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("beforeId");
    return route.fulfill({
      json: cursor
        ? [activity(297), activity(298)]
        : [activity(299), activity(newest)],
      headers: cursor ? {} : { "X-Next-Before-Id": "299" },
    });
  });
  await page.goto("/projects/101?view=plan");
  const region = page.getByRole("region", { name: c.title, exact: true });
  await expect(
    region.getByText("Original activity 原文 300", { exact: true }),
  ).toBeVisible();
  const nav = region.getByRole("navigation", { name: "Record pages" });
  await nav.getByRole("button", { name: "Older records", exact: true }).click();
  await expect(
    region.getByText("Original activity 原文 298", { exact: true }),
  ).toBeVisible();
  newest = 400;
  await page.clock.fastForward(16000);
  await expect(
    region.getByText("Original activity 原文 400", { exact: true }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await region.getByRole("button", { name: c.export, exact: true }).click();
  const file = await download;
  const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(payload.boundary).toMatchObject({
    taskId: 101,
    beforeId: 299,
    nextBeforeId: null,
    pageNumber: 2,
    fullHistory: false,
    receipts: false,
    paginationOrder: "id-desc",
    exportOrder: "createdAt-asc,id-asc",
  });
  expect(payload.events.map((row: { id: number }) => row.id)).toEqual([
    297, 298,
  ]);
  expect(payload.task).toMatchObject({
    id: 101,
    stepCounter: 7,
    cycleCounter: 2,
  });
  await nav
    .getByRole("button", { name: "Latest records", exact: true })
    .click();
  await expect(
    region.getByText("Original activity 原文 400", { exact: true }),
  ).toBeVisible();
});

test("child-task pagination and a selected delegation ignore the previous task's late response", async ({
  page,
}) => {
  await projectSetup(page);
  const c = await loadTraceCopy("en"),
    studio = await loadProjectStudioCopy("en");
  const child = (id: number) => ({
    ...project(id),
    parentTaskId: 101,
    assignedByAgentId: 1,
  });
  await page.route("**/api/tasks/101/subtasks**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("beforeId");
    return route.fulfill({
      json: cursor ? [child(201)] : [child(202), child(203)],
      headers: cursor ? {} : { "X-Next-Before-Id": "202" },
    });
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let olderRequested = false,
    oldReplyCompleted = false;
  await page.route(/\/api\/tasks\/(201|202|203)\/activity/, async (route) => {
    const url = new URL(route.request().url()),
      taskId = Number(url.pathname.split("/")[3]);
    const older = url.searchParams.has("beforeId");
    if (taskId === 203 && older) {
      olderRequested = true;
      await held;
      await route.fulfill({ json: [activity(299, 203)] }).catch(() => {});
      oldReplyCompleted = true;
      return;
    }
    await route.fulfill({
      json: [activity(taskId + 100, taskId)],
      headers: taskId === 203 ? { "X-Next-Before-Id": "303" } : {},
    });
  });
  await page.goto("/projects/101?view=team");
  const delegation = page.getByRole("region", {
    name: c.delegations,
    exact: true,
  });
  const picker = delegation.getByRole("combobox");
  await expect(picker).toHaveValue("202");
  await picker.selectOption("203");
  await expect(
    delegation.getByText("Original activity 原文 303", { exact: true }),
  ).toBeVisible();
  await delegation
    .getByRole("button", { name: "Older records", exact: true })
    .click();
  await expect.poll(() => olderRequested).toBe(true);
  await picker.selectOption("202");
  await expect(
    delegation.getByText("Original activity 原文 302", { exact: true }),
  ).toBeVisible();
  release();
  await expect.poll(() => oldReplyCompleted).toBe(true);
  await expect(
    delegation.getByText("Original activity 原文 299", { exact: true }),
  ).toHaveCount(0);
  await expect(picker).toHaveValue("202");
  const tasks = page.getByRole("region", { name: studio.plan, exact: true });
  await tasks
    .getByRole("button", { name: "Older records", exact: true })
    .click();
  await expect(picker).toHaveValue("201");
  await expect(
    delegation.getByText("Original activity 原文 301", { exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole("option")).toHaveCount(1);
  await tasks
    .getByRole("button", { name: "Latest records", exact: true })
    .click();
  await expect(picker).toHaveValue("202");
});

test("a foreign task response is rejected without replacing the retained trace or exposing source", async ({
  page,
}) => {
  await page.clock.install();
  await projectSetup(page);
  let foreign = false;
  await page.route("**/api/tasks/101/activity**", (route) =>
    route.fulfill({
      json: [activity(foreign ? 99 : 100, foreign ? 999 : 101)],
    }),
  );
  await page.goto("/projects/101?view=plan");
  const region = page.getByRole("region", {
    name: "Activity records",
    exact: true,
  });
  await expect(
    region.getByText("Original activity 原文 100", { exact: true }),
  ).toBeVisible();
  foreign = true;
  await page.clock.fastForward(6000);
  await expect(
    region.getByText(
      "Refresh failed. The last loaded records remain visible.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    region.getByText("Original activity 原文 100", { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText("Original activity 原文 99", { exact: true }),
  ).toHaveCount(0);
});
