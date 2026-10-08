import { expect, test, type Page, type Route } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadCodingRecoveryCopy } from "../../artifacts/agentic-company-os/src/lib/coding-recovery-copy";
import {
  LOCALES,
  setupMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
const now = "2026-10-04T08:00:00.000Z";
test("only the chosen recovery language loads; a failed pack preserves an uncertain request until explicit inspection", async ({
  page,
}) => {
  const packs: string[] = [];
  page.on("request", (request) => {
    const match = request
      .url()
      .match(/\/assets\/coding-recovery-([^/]+)-[^/]+\.js$/);
    if (match) packs.push(match[1]);
  });
  const f = await fixture(page, "en", true),
    c = await loadCodingRecoveryCopy("en");
  const panel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: c.title }) });
  await panel.locator("summary").click();
  await panel.getByRole("checkbox", { name: c.acknowledge }).check();
  await panel.getByRole("button", { name: c.reset }).click();
  await expect(panel.getByText(c.unknown, { exact: true })).toBeVisible();
  expect(new Set(packs)).toEqual(new Set(["en"]));
  const saved = await page.evaluate(() =>
    sessionStorage.getItem("acos.coding-recovery.v1:501"),
  );
  let fail = true;
  await page.route(/\/assets\/coding-recovery-en-[^/]+\.js$/, (route) =>
    fail ? route.abort("failed") : route.continue(),
  );
  await page.reload();
  const fallback = page.locator("[data-coding-session-recovery]");
  await expect(fallback.getByRole("alert")).toHaveText(
    setupMessages.en.languageFileError,
  );
  expect(f.writes).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.coding-recovery.v1:501"),
    ),
  ).toBe(saved);
  fail = false;
  await fallback
    .getByRole("button", { name: setupMessages.en.checkAgain })
    .click();
  await expect(panel.getByRole("button", { name: c.inspect })).toBeVisible();
  expect(f.writes).toHaveLength(1);
  await panel.getByRole("button", { name: c.inspect }).click();
  await expect(panel.getByText(c.success, { exact: true })).toBeVisible();
  expect(f.writes).toHaveLength(1);
});
const task = {
  id: 501,
  title: "Recovery fixture",
  brief: "Preserve useful work",
  status: "blocked",
  priority: "normal",
  ownerAgentId: 1,
  assignedByAgentId: null,
  createdByUser: true,
  parentTaskId: null,
  progressPercent: 30,
  tokensUsed: 8,
  estimatedCostUsd: null,
  resultSummary: null,
  executionModelId: null,
  lastModelId: "chatgpt:fixture",
  lastModelProvider: "chatgpt",
  modelFallbackCount: 0,
  autonomyMode: "finite",
  cadenceSeconds: null,
  lastHeartbeatAt: now,
  recoveryCount: 0,
  cycleCount: 0,
  lastCycleCompletedAt: null,
  lastSteppedAt: now,
  stepAttempts: 1,
  consecutiveFailures: 1,
  nextAttemptAt: null,
  lastError: null,
  blockedReason: "operation_outcome_unknown",
  dueAt: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
};
async function fixture(page: Page, locale: Locale, lose = false) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const base = await installStudioFixtures(page);
  let state = "uncertain",
    revision = 4;
  let receipt: Record<string, unknown> | null = null;
  const writes: Array<Record<string, unknown>> = [];
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  await page.route("**/api/tasks/501**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/tasks/501") return json(route, task);
    if (path === "/api/tasks/501/members") return json(route, []);
    if (
      path === "/api/tasks/501/subtasks" ||
      path === "/api/tasks/501/activity"
    )
      return json(route, []);
    if (path === "/api/tasks/501/coding-session")
      return json(route, {
        taskId: 501,
        sessionState: state,
        revision,
        cleanupState: "verified",
        canReset: state === "uncertain",
        reason: state === "uncertain" ? null : "already_reset",
        requiresRevalidation: true,
      });
    if (
      path === "/api/tasks/501/coding-session/recover" &&
      req.method() === "POST"
    ) {
      const input = req.postDataJSON();
      writes.push(input);
      state = "reset";
      revision = 5;
      receipt = {
        taskId: 501,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        outcome: "accepted",
        reason: null,
        revision: 5,
        recordedAt: Date.now(),
        taskResumed: false,
        effectsReconciled: false,
      };
      if (lose) return route.abort("failed");
      return json(route, receipt);
    }
    if (path.startsWith("/api/tasks/501/coding-session/recover/"))
      return json(route, receipt ?? { error: "missing" }, receipt ? 200 : 404);
    return route.fallback();
  });
  await page.route("**/api/agents/1/messages**", (route) => json(route, []));
  await page.route("**/api/project-meetings**", (route) => json(route, []));
  await page.goto("/projects/501");
  await expect(page.getByRole("heading", { name: task.title })).toBeVisible();
  return { writes, unexpected: base.unexpected };
}
for (const locale of LOCALES)
  for (const width of [320, 390])
    test(`${locale} ${width}px explicit coding recovery preserves paused-task truth and accessible controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const f = await fixture(page, locale);
      const c = await loadCodingRecoveryCopy(locale);
      const panel = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: c.title }) });
      await panel.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(
        panel.getByRole("checkbox", { name: c.acknowledge }),
      ).toBeVisible();
      const reset = panel.getByRole("button", { name: c.reset });
      await expect(reset).toBeDisabled();
      expect(f.writes).toHaveLength(0);
      await panel.getByRole("checkbox", { name: c.acknowledge }).check();
      await expect(reset).toBeEnabled();
      for (const control of [
        panel.locator("summary"),
        reset,
        panel.locator("label"),
      ])
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
      expect(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await reset.click();
      await expect(panel.getByText(c.success, { exact: true })).toBeVisible();
      expect(f.writes).toHaveLength(1);
      expect(f.writes[0]).toMatchObject({
        expectedRevision: 4,
        acknowledgeUncertainEffects: true,
      });
      await expect(panel.getByText(c.success, { exact: true })).toBeFocused();
      if (locale === "en" && width === 390)
        await panel.screenshot({
          path: ".tmp/coding-recovery-en-390-accepted.png",
        });
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("acos.coding-recovery.v1:501"),
        ),
      ).toBeNull();
      expect(await page.locator("html").getAttribute("dir")).toBe(
        locale === "ar" ? "rtl" : "ltr",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
    });
test("a lost reset response survives reload without a second write and is settled only by explicit receipt inspection", async ({
  page,
}) => {
  const f = await fixture(page, "en", true),
    c = await loadCodingRecoveryCopy("en");
  const panel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: c.title }) });
  await panel.locator("summary").click();
  await panel.getByRole("checkbox", { name: c.acknowledge }).check();
  await panel.getByRole("button", { name: c.reset }).click();
  await expect(panel.getByText(c.unknown, { exact: true })).toBeVisible();
  const before = await page.evaluate(() =>
    sessionStorage.getItem("acos.coding-recovery.v1:501"),
  );
  expect(before).not.toBeNull();
  await page.reload();
  await expect(panel.getByRole("button", { name: c.inspect })).toBeVisible();
  expect(f.writes).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.coding-recovery.v1:501"),
    ),
  ).toBe(before);
  await panel.getByRole("button", { name: c.inspect }).click();
  await expect(panel.getByText(c.success, { exact: true })).toBeVisible();
  expect(f.writes).toHaveLength(1);
});
test("blocked browser storage never sends a reset", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.coding-recovery"))
        throw new DOMException("Fixture quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const f = await fixture(page, "en"),
    c = await loadCodingRecoveryCopy("en");
  const panel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: c.title }) });
  await panel.locator("summary").click();
  await panel.getByRole("checkbox", { name: c.acknowledge }).check();
  await panel.getByRole("button", { name: c.reset }).click();
  await expect(panel.getByRole("alert")).toHaveText(c.storage);
  expect(f.writes).toHaveLength(0);
});

test("light appearance preserves readable contrast and keyboard access without starting recovery", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("acos.color-mode.v2", "light"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, "en"),
    c = await loadCodingRecoveryCopy("en");
  const panel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: c.title }) });
  await panel.locator("summary").focus();
  await page.keyboard.press("Enter");
  await panel.getByRole("checkbox", { name: c.acknowledge }).check();
  await expect(panel.getByRole("button", { name: c.reset })).toBeEnabled();
  const contrast = await panel.evaluate((el) => {
    const channels = (color: string) => {
      const parts = color.match(/[\d.]+/g)!.map(Number);
      return parts
        .slice(0, 3)
        .map((v) => (color.startsWith("color(srgb") ? v : v / 255));
    };
    const luminance = (color: string) =>
      channels(color)
        .map((v) =>
          v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
        )
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (foreground: string, background: string) => {
      const a = luminance(foreground),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const button = getComputedStyle(el.querySelector("button")!),
      copy = getComputedStyle(el.querySelector("p")!),
      card = getComputedStyle(el);
    return {
      copy: ratio(copy.color, card.backgroundColor),
      button: ratio(button.color, button.backgroundColor),
    };
  });
  expect(contrast.copy).toBeGreaterThanOrEqual(4.5);
  expect(contrast.button).toBeGreaterThanOrEqual(4.5);
  expect(f.writes).toHaveLength(0);
  await panel.screenshot({ path: ".tmp/coding-recovery-en-390-light.png" });
});
