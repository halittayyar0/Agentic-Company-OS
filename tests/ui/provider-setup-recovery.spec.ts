import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

const READY_CATALOG = {
  providers: [{ id: "openai", label: "OpenAI", available: true }],
  models: [
    {
      id: "openai:test",
      provider: "openai",
      label: "Test",
      description: "Recovery test model",
      tier: "standard",
      supportsTools: true,
      isDefault: true,
    },
  ],
};

for (const [locale, error, retry, checking] of [
  [
    "tr",
    "Model kullanılabilirliği kontrol edilemedi.",
    "Yeniden denetle",
    "Kullanılabilir modeller kontrol ediliyor…",
  ],
  [
    "en",
    "Could not check model availability.",
    "Check again",
    "Checking available models…",
  ],
  [
    "de",
    "Die Modellverfügbarkeit konnte nicht geprüft werden.",
    "Erneut prüfen",
    "Verfügbare Modelle werden geprüft…",
  ],
  [
    "ru",
    "Не удалось проверить доступность модели.",
    "Проверить снова",
    "Проверяем доступные модели…",
  ],
  ["zh-CN", "无法检查模型是否可用。", "重新检查", "正在检查可用模型…"],
  ["zh-TW", "無法檢查模型是否可用。", "重新檢查", "正在檢查可用模型…"],
  [
    "ar",
    "تعذّر التحقق من توفر النموذج.",
    "أعد الفحص",
    "جارٍ التحقق من النماذج المتاحة…",
  ],
] as const) {
  test(`${locale} model-check failure can recover without losing the home draft`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(
      (selected) => localStorage.setItem("acos.locale.v1", selected),
      locale,
    );
    const harness = await installStudioFixtures(page);
    let attempts = 0;
    let finishRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    await page.route("**/api/model-catalog", async (route) => {
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      await retryGate;
      return route.fulfill({ json: READY_CATALOG });
    });
    try {
      await page.goto("/");
      const notice = page.getByRole("alert").filter({ hasText: error });
      await expect(notice).toBeVisible();
      const noticeWidth = await notice.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      const descriptionWidth = await notice
        .locator("span")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(descriptionWidth).toBeGreaterThan(noticeWidth / 2);
      await expect(notice.getByRole("link")).toHaveAttribute(
        "href",
        "/settings",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (locale === "en" || locale === "ar") {
        await page.screenshot({
          path: testInfo.outputPath("model-check-recovery.png"),
          fullPage: true,
        });
      }
      const draft = page.locator("#project-outcome");
      const selectedMode = page
        .getByRole("group")
        .filter({ has: page.getByRole("button", { pressed: true }) })
        .getByRole("button")
        .nth(1);
      await selectedMode.click();
      await draft.fill("Turn these meeting notes into an action list.");
      await expect(
        notice.getByRole("button", { name: retry, exact: true }),
      ).toBeVisible();
      const retryButton = notice.getByRole("button");
      await retryButton.focus();
      await page.keyboard.press("Enter");
      await expect(retryButton).toBeDisabled();
      await expect(retryButton).toContainText(checking);
      expect(
        await retryButton.evaluate(
          (button) => button.getBoundingClientRect().height,
        ),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(draft).toHaveValue(
        "Turn these meeting notes into an action list.",
      );
      finishRetry();
      await expect(notice).toHaveCount(0);
      await expect(draft).toBeFocused();
      await expect(selectedMode).toHaveAttribute("aria-pressed", "true");
      await expect(draft).toHaveValue(
        "Turn these meeting notes into an action list.",
      );
      expect(attempts).toBe(2);
      expect(harness.requests).toHaveLength(0);
      expect([...harness.unexpected]).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
    } finally {
      finishRetry();
    }
  });
}

test("a slow first model check remains visible while the user writes a job", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  let finishCheck!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishCheck = resolve;
  });
  await page.route("**/api/model-catalog", async (route) => {
    await gate;
    await route.fulfill({ json: { providers: [], models: [] } });
  });
  try {
    await page.goto("/");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Checking available models…" }),
    ).toBeVisible();
    await page.locator("#project-outcome").fill("Summarize my meeting notes.");
    finishCheck();
    await expect(
      page.getByRole("link", { name: "Connect a model" }),
    ).toBeVisible();
    await expect(page.getByText(/You can save a project now/u)).toBeVisible();
    await expect(page.getByText(/Your project is saved/u)).toHaveCount(0);
    await expect(page.locator("#project-outcome")).toHaveValue(
      "Summarize my meeting notes.",
    );
  } finally {
    finishCheck();
  }
});

test("a second failed check remains retryable and a model without tools still needs setup", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let attempts = 0;
  await page.route("**/api/model-catalog", (route) => {
    attempts++;
    return route.fulfill({
      status: attempts < 3 ? 503 : 200,
      json:
        attempts < 3
          ? { error: "Unavailable" }
          : {
              ...READY_CATALOG,
              models: READY_CATALOG.models.map((model) => ({
                ...model,
                supportsTools: false,
              })),
            },
    });
  });
  await page.goto("/");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Could not check model availability." });
  const retry = notice.getByRole("button", {
    name: "Check again",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page
    .locator("#project-outcome")
    .fill("Extract the actions from these notes.");
  await retry.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(retry).toBeEnabled();
  await expect(retry).toBeFocused();
  await expect(notice).toBeVisible();
  await retry.click();
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Connect a model", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Connect a model", exact: true }),
  ).toBeFocused();
  await expect(page.getByText(/You can save a project now/u)).toBeVisible();
  await expect(page.locator("#project-outcome")).toHaveValue(
    "Extract the actions from these notes.",
  );
  expect(attempts).toBe(3);
  expect(harness.requests).toHaveLength(0);
  expect([...harness.unexpected]).toEqual([]);
});

test("a failed refresh shows recovery even when a ready catalog was cached", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let unavailable = false;
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({
      status: unavailable ? 503 : 200,
      json: unavailable ? { error: "Unavailable" } : READY_CATALOG,
    }),
  );
  const firstResponse = page.waitForResponse("**/api/model-catalog");
  await page.goto("/");
  await expect(page.locator("#project-outcome")).toBeVisible();
  await firstResponse;
  await expect(page.getByRole("link", { name: "Connect a model" })).toHaveCount(
    0,
  );
  unavailable = true;
  await page.clock.fastForward(31_000);
  await page.getByRole("button", { name: "Create new", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/new$/u);
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Could not check model availability." });
  await expect(notice).toBeVisible();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  const brief = page.getByRole("textbox", {
    name: "Goal and scope",
    exact: true,
  });
  await name.fill("Meeting actions");
  await brief.fill("Extract an owner and deadline for each action.");
  const ongoing = page
    .getByRole("radiogroup")
    .first()
    .getByRole("radio")
    .nth(1);
  const priority = page
    .getByRole("radiogroup")
    .nth(1)
    .getByRole("radio")
    .last();
  await ongoing.click();
  await priority.click();
  await page.locator("#cadence").selectOption("900");
  unavailable = false;
  await notice
    .getByRole("button", { name: "Check again", exact: true })
    .click();
  await expect(notice).toHaveCount(0);
  await expect(brief).toBeFocused();
  await expect(ongoing).toHaveAttribute("aria-checked", "true");
  await expect(priority).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#cadence")).toHaveValue("900");
  await expect(name).toHaveValue("Meeting actions");
  await expect(brief).toHaveValue(
    "Extract an owner and deadline for each action.",
  );
  expect(harness.requests).toHaveLength(0);
  expect([...harness.unexpected]).toEqual([]);
});

test("finishing a model retry does not take focus from a user editing their draft", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let attempts = 0;
  let finishRetry!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishRetry = resolve;
  });
  await page.route("**/api/model-catalog", async (route) => {
    if (++attempts === 1)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    await gate;
    return route.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  try {
    await page.goto("/");
    const retry = page
      .getByRole("alert")
      .filter({ hasText: "Could not check model availability." })
      .getByRole("button");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(retry).toBeDisabled();
    const draft = page.locator("#project-outcome");
    await draft.fill("Continue editing while the check is pending.");
    finishRetry();
    await expect(retry).toBeEnabled();
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue(
      "Continue editing while the check is pending.",
    );
    expect(harness.requests).toHaveLength(0);
    expect([...harness.unexpected]).toEqual([]);
  } finally {
    finishRetry();
  }
});
