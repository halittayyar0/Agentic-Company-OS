import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import { loadProjectStudioCopy } from "../../artifacts/agentic-company-os/src/lib/project-studio-copy";
import { loadInferenceAccountingCopy } from "../../artifacts/agentic-company-os/src/lib/inference-accounting-copy";
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
const recoveryActions = {
  tr: "Kullanımı uygula",
  en: "Apply usage",
  de: "Nutzung anwenden",
  ru: "Учесть расход",
  "zh-CN": "应用用量",
  "zh-TW": "套用用量",
  ar: "تطبيق السجل",
};
for (const locale of ["en", "ar"] as const) {
  for (const acknowledgement of ["lost", "foreign"] as const) {
    test(`${locale} accounting ${acknowledgement} acknowledgement refreshes retry eligibility without automatic POST`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      const f = await fixture(page, locale),
        c = await loadProjectStudioCopy(locale),
        accountingCopy = await loadInferenceAccountingCopy(locale);
      f.setState("recovery_required");
      f.setEvidence(true);
      let scopeGets = 0,
        applied = false,
        usagePosts = 0,
        retryPosts = 0;
      await page.route("**/api/tasks/501/response-retry", async (route) => {
        if (route.request().method() === "GET") {
          scopeGets++;
          return route.fulfill({
            json: {
              taskId: 501,
              canRetry: applied,
              blockedAttemptId: applied ? requestId : null,
            },
          });
        }
        retryPosts++;
        expect(route.request().postDataJSON()).toEqual({
          blockedAttemptId: requestId,
          acknowledge: true,
        });
        return route.fulfill({
          json: {
            taskId: 501,
            blockedAttemptId: requestId,
            outcome: "accepted",
            recordedAt: "2026-10-11T08:00:00.000Z",
          },
        });
      });
      await page.route(
        "**/api/inference-accounting/*/reconcile?**",
        async (route) => {
          usagePosts++;
          applied = true;
          f.setState("clear");
          f.setEvidence(false);
          return route.fulfill({
            status: acknowledgement === "lost" ? 502 : 200,
            json:
              acknowledgement === "lost"
                ? { error: "Lost acknowledgement" }
                : {
                    scopeType: "task",
                    scopeId: 999,
                    attemptId: requestId,
                    outcome: "applied",
                  },
          });
        },
      );
      await page.goto("/projects/501");
      const accounting = page.locator("[data-inference-accounting]"),
        retry = page.getByTestId("response-task-retry"),
        action = retry.getByRole("button", {
          name: c.responseRetryAction,
          exact: true,
        });
      await expect.poll(() => scopeGets).toBeGreaterThan(0);
      await expect(action).toHaveCount(0);
      await accounting
        .getByRole("button", { name: recoveryActions[locale], exact: true })
        .click();
      await expect(accounting).toHaveAttribute(
        "data-accounting-status",
        "clear",
      );
      await expect(
        accounting.getByText(accountingCopy[4], { exact: true }),
      ).toBeVisible();
      await expect(action).toBeEnabled();
      expect(usagePosts).toBe(1);
      expect(retryPosts).toBe(0);
      await action.click();
      await expect(
        retry.getByText(c.responseRetryAccepted, { exact: true }),
      ).toBeVisible();
      expect(usagePosts).toBe(1);
      expect(retryPosts).toBe(1);
    });
  }
}
for (const locale of Object.keys(labels) as Array<keyof typeof labels>) {
  test(`${locale} 320px explicit saved-usage recovery updates records without resuming or resending work`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const f = await fixture(page, locale);
    f.setState("recovery_required");
    f.setEvidence(true);
    let posts = 0;
    await page.route(
      "**/api/inference-accounting/*/reconcile?**",
      async (route) => {
        posts++;
        const request = route.request(),
          query = new URL(request.url()).searchParams;
        expect(request.method()).toBe("POST");
        expect(request.headers()["content-type"]).toBe("application/json");
        expect(request.postDataJSON()).toEqual({ acknowledge: true });
        expect(query.get("scopeType")).toBe("task");
        expect(query.get("scopeId")).toBe("501");
        f.setState("clear");
        f.setEvidence(false);
        await route.fulfill({
          json: {
            scopeType: "task",
            scopeId: 501,
            attemptId: requestId,
            outcome: "applied",
          },
        });
      },
    );
    await page.goto("/projects/501");
    await page.addStyleTag({ content: "html {font-size:32px !important;}" });
    const panel = page.locator("[data-inference-accounting]");
    const recover = panel.getByRole("button", {
      name: recoveryActions[locale],
      exact: true,
    });
    await expect(recover).toBeVisible();
    expect(
      await recover.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (["en", "ar"].includes(locale))
      await panel.screenshot({
        path: info.outputPath(`saved-usage-${locale}-320px-large.png`),
      });
    expect(posts).toBe(0);
    await recover.click();
    await expect(panel).toHaveAttribute("data-accounting-status", "clear");
    expect(posts).toBe(1);
    await expect(recover).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(new Set(f.methods)).toEqual(new Set(["GET"]));
  });
}
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
    savedEvidenceAvailable = false,
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
                savedEvidenceAvailable,
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
    setEvidence: (value: boolean) => {
      savedEvidenceAvailable = value;
    },
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
