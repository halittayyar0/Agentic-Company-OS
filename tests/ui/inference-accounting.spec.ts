import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
const labels = {
  tr: "Model kullanım kayıtları",
  en: "Model usage records",
  de: "Modellnutzungsprotokolle",
  ru: "Учёт использования моделей",
  "zh-CN": "模型用量记录",
  "zh-TW": "模型用量紀錄",
  ar: "سجلات استخدام النماذج",
};
const requestId = "11111111-1111-4111-8111-111111111111";
test("Arabic accounting records remain usable with light appearance, 200 percent text and keyboard disclosure on a 320px phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  const f = await fixture(page, "ar");
  await page.goto("/projects/501");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const panel = page.locator("[data-inference-accounting]");
  await expect(panel).toHaveAttribute("data-accounting-status", "pending");
  const summary = panel.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(panel).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button")).toBeVisible();
  f.setState("recovery_required");
  await panel.getByRole("button").click();
  await expect(panel).toHaveAttribute(
    "data-accounting-status",
    "recovery_required",
  );
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await panel.screenshot({
    path: ".tmp/task6-inference-accounting-ar-large-light.png",
  });
  expect(new Set(f.methods)).toEqual(new Set(["GET"]));
});
async function fixture(page: Page, locale: keyof typeof labels) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  await installStudioFixtures(page);
  await page.route("**/api/agents/1", (route) =>
    route.fulfill({ json: studioAgents[0] }),
  );
  await page.route("**/api/agents/1/messages**", (route) =>
    route.fulfill({ json: [] }),
  );
  const task = {
    id: 501,
    title: "Accounting fixture",
    brief: "Preserve useful work",
    status: "blocked",
    priority: "normal",
    ownerAgentId: 1,
    parentTaskId: null,
    progressPercent: 30,
    tokensUsed: 8,
    estimatedCostUsd: null,
    resultSummary: null,
    autonomyMode: "finite",
    blockedReason: "runtime_failure",
    lastError: null,
    createdAt: "2026-10-09T08:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z",
    cycleCount: 0,
    modelFallbackCount: 0,
    recoveryCount: 0,
    consecutiveFailures: 0,
  };
  await page.route("**/api/tasks/501**", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === "/api/tasks/501"
          ? task
          : [],
    }),
  );
  let state = "pending",
    invalidTime = false,
    fail = false,
    wrongScope = false;
  const methods: string[] = [];
  await page.route("**/api/inference-accounting?**", (route) => {
    methods.push(route.request().method());
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { error: "unavailable" }
        : {
            scopeType: query.get("scopeType"),
            scopeId: wrongScope ? 999 : Number(query.get("scopeId")),
            rootTaskId: query.get("scopeType") === "task" ? 501 : null,
            status: state,
            observedAt: invalidTime ? 9e15 : Date.now(),
            unsettledCount: state === "clear" ? 0 : 1,
            hasMore: false,
            attempts: [
              {
                id: requestId,
                agentId: 1,
                taskId: 501,
                provider: "ollama",
                modelId: "fixture-model",
                kind: "chat",
                state:
                  state === "clear"
                    ? "accounted"
                    : state === "pending"
                      ? "dispatched"
                      : "uncertain",
                createdAt: Date.now() - 1000,
                requestDeadlineAt: Date.now() + 1000,
                dispatchedAt: Date.now() - 1000,
                settledAt: state === "pending" ? null : Date.now(),
                usage:
                  state === "clear"
                    ? {
                        promptTokens: 2,
                        completionTokens: 3,
                        totalTokens: 5,
                        usageReported: true,
                        reportedCostUsd: null,
                      }
                    : null,
              },
            ],
          },
    });
  });
  return {
    methods,
    setState: (value: string) => {
      state = value;
    },
    setFail: (value: boolean) => {
      fail = value;
    },
    setWrongScope: (value: boolean) => {
      wrongScope = value;
    },
    setInvalidTime: (value: boolean) => {
      invalidTime = value;
    },
  };
}
for (const locale of Object.keys(labels) as Array<keyof typeof labels>)
  for (const width of [320, 1280]) {
    test(`${locale} ${width}px accounting records preserve uncertainty and inspect settled usage without resending`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const f = await fixture(page, locale);
      await page.goto("/projects/501");
      const panel = page.locator("[data-inference-accounting]");
      await expect(panel.locator("summary")).toContainText(labels[locale]);
      await expect(panel).toHaveAttribute("data-accounting-status", "pending");
      await expect(panel.getByText(requestId, { exact: true })).toBeVisible();
      f.setState("recovery_required");
      await panel.getByRole("button").click();
      await expect(panel).toHaveAttribute(
        "data-accounting-status",
        "recovery_required",
      );
      if ((locale === "en" || locale === "ar") && width === 320)
        await panel.screenshot({
          path: `.tmp/task6-inference-accounting-${locale}-320.png`,
        });
      f.setState("clear");
      await panel.getByRole("button").click();
      await expect(panel).toHaveAttribute("data-accounting-status", "clear");
      await expect(
        panel.getByText("fixture-model", { exact: false }),
      ).toBeVisible();
      expect(new Set(f.methods)).toEqual(new Set(["GET"]));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.locator("html").getAttribute("dir")).toBe(
        locale === "ar" ? "rtl" : "ltr",
      );
    });
  }
test("failed and cross-scope observations keep the last unknown record; agent records use the agent scope", async ({
  page,
}) => {
  const f = await fixture(page, "en");
  await page.goto("/agents/1");
  const panel = page.locator("[data-inference-accounting]");
  await expect(panel).toHaveAttribute("data-accounting-status", "pending");
  f.setState("recovery_required");
  await panel.getByRole("button").click();
  await expect(panel).toHaveAttribute(
    "data-accounting-status",
    "recovery_required",
  );
  f.setFail(true);
  await panel.getByRole("button").click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByText(requestId, { exact: true })).toBeVisible();
  f.setFail(false);
  f.setWrongScope(true);
  f.setState("clear");
  await panel.getByRole("button").click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel).toHaveAttribute("data-accounting-status", "unverified");
  f.setWrongScope(false);
  f.setInvalidTime(true);
  await panel.getByRole("button").click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByText(requestId, { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute("data-accounting-status", "unverified");
  expect(new Set(f.methods)).toEqual(new Set(["GET"]));
});
