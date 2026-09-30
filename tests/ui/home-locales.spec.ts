import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";

function watchHomeLanguageChunks(page: Page): string[] {
  const requested: string[] = [];
  page.on("request", (request) => {
    const name = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    if (/^(?:tr|en|de|ru|zh-CN|zh-TW|ar)-[^/]+\.js$/u.test(name)) {
      requested.push(name);
    }
  });
  return requested;
}

test("English home can start a project with English instructions and errors", async ({
  page,
}) => {
  const localeChunks = watchHomeLanguageChunks(page);
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "What should we accomplish together today?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Try a useful check without a model/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Connect a model" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Your project is saved, and the team waits/u),
  ).toBeVisible();
  await page.getByRole("button", { name: "Build a website" }).click();
  const brief = page.getByRole("textbox", { name: "The result you want" });
  await expect(brief).toHaveValue(/mobile-friendly website/);
  await brief.fill("Create an accessible booking experience for my customers.");
  await page.getByRole("button", { name: "Start project" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your draft is saved here" }),
  ).toBeVisible();
  await expect(brief).toHaveValue(/accessible booking experience/);
  expect(harness.requests).toHaveLength(1);
  expect(harness.requests[0].body).toMatchObject({
    autonomyMode: "finite",
    priority: "normal",
    brief: expect.stringContaining(
      "Work approach — Build a product: Build a working product.",
    ),
  });
  expect([...harness.unexpected]).toEqual([]);
  expect(localeChunks).toHaveLength(1);
  expect(localeChunks[0]).toMatch(/^en-/u);
});

test("Arabic home keeps the project composer usable on a narrow light screen", async ({
  page,
}) => {
  const localeChunks = watchHomeLanguageChunks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveClass(/light/u);
  await expect(
    page.getByRole("heading", { name: "ما الذي سننجزه معًا اليوم؟" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /جرّب فحص/u })).toBeVisible();
  await expect(page.getByRole("link", { name: "اربط نموذجًا" })).toBeVisible();
  await page.getByRole("button", { name: "أنشئ موقعًا" }).click();
  await expect(
    page.getByRole("textbox", { name: "النتيجة التي تريدها" }),
  ).toHaveValue(/موقعًا/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect([...harness.unexpected]).toEqual([]);
  expect(localeChunks).toHaveLength(1);
  expect(localeChunks[0]).toMatch(/^ar-/u);
});

test("a connected tool-capable model removes the setup guidance", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({
      json: {
        providers: [{ id: "openai", label: "OpenAI", available: true }],
        models: [
          {
            id: "openai:test",
            provider: "openai",
            label: "Test",
            description: "Test model",
            tier: "standard",
            supportsTools: true,
            isDefault: true,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Connect a model" })).toHaveCount(
    0,
  );
  expect([...harness.unexpected]).toEqual([]);
});

for (const [locale, action] of [
  ["tr", "Model bağla"],
  ["de", "Modell verbinden"],
  ["ru", "Подключить"],
  ["zh-CN", "连接模型"],
  ["zh-TW", "連接模型"],
] as const) {
  test(`${locale} home links to model setup when a provider is missing`, async ({
    page,
  }) => {
    await page.addInitScript((selected) => {
      localStorage.setItem("acos.locale.v1", selected);
    }, locale);
    const harness = await installStudioFixtures(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: action })).toBeVisible();
    expect([...harness.unexpected]).toEqual([]);
  });
}

test("home opens the model-free utility workbench", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: getCapabilityCatalog("en") }),
  );
  await page.goto("/");
  await page
    .getByRole("link", { name: /Try a useful check without a model/u })
    .click();
  await expect(page).toHaveURL(/\/skills$/u);
  await expect(
    page.locator("#utility-workbench").getByRole("heading", {
      name: "Get a useful result now",
    }),
  ).toBeVisible();
  expect(harness.requests).toHaveLength(0);
  expect([...harness.unexpected]).toEqual([]);
});

test("a missing language pack shows a translated recovery state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/assets/en-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText(
    "Could not load the home page language file.",
  );
  const retry = page.getByRole("button", { name: "Check again", exact: true });
  await expect(retry).toBeVisible();
  await page.unroute("**/assets/en-*.js");
  await retry.click();
  await expect(
    page.getByRole("heading", {
      name: "What should we accomplish together today?",
    }),
  ).toBeVisible();
  expect([...harness.unexpected]).toEqual([]);
});
