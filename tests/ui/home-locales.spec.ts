import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

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
