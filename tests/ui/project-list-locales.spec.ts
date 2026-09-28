import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

function watchProjectLanguageChunks(page: Page): string[] {
  const requested: string[] = [];
  page.on("request", (request) => {
    const name = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    if (/^projects-(?:tr|en|de|ru|zh-CN|zh-TW|ar)-[^/]+\.js$/u.test(name)) {
      requested.push(name);
    }
  });
  return requested;
}

test("English projects preserve the visible outcome through search and status filters", async ({
  page,
}) => {
  const localeChunks = watchProjectLanguageChunks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/api/tasks?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 101,
          parentTaskId: null,
          title: "Booking site",
          brief:
            "Ship a booking site.\n\nWork approach — Build a product: Build a working product.",
          status: "in_progress",
          ownerAgentId: 1,
          progressPercent: 72,
          updatedAt: "2026-09-26T10:00:00.000Z",
        },
      ]),
    }),
  );

  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Booking site" }),
  ).toBeVisible();
  await expect(
    page.getByText("Ship a booking site.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Work approach — Build a product", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect(page.getByText("72%", { exact: true })).toBeVisible();
  await page
    .getByRole("group", { name: "Filter projects by status" })
    .getByRole("button", { name: /Completed/ })
    .click();
  await expect(page.getByText("No projects here")).toBeVisible();
  await page
    .getByRole("group", { name: "Filter projects by status" })
    .getByRole("button", { name: /Active/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Booking site" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search projects" }).fill("missing");
  await expect(
    page.getByText("Change the filter or search terms."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect([...harness.unexpected]).toEqual([]);
  expect(localeChunks).toHaveLength(1);
  expect(localeChunks[0]).toMatch(/^projects-en-/u);
});

test("Arabic projects show a usable first-project state on a narrow screen", async ({
  page,
}) => {
  const localeChunks = watchProjectLanguageChunks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/projects");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { level: 1, name: "المشاريع" }),
  ).toBeVisible();
  await expect(page.getByText("الفريق مستعد للمشروع الأول")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "أنشئ المشروع الأول" }),
  ).toHaveAttribute("href", "/projects/new");
  await expect(
    page.getByRole("textbox", { name: "ابحث في المشاريع" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect([...harness.unexpected]).toEqual([]);
  expect(localeChunks).toHaveLength(1);
  expect(localeChunks[0]).toMatch(/^projects-ar-/u);
});

test("Projects page recovers after its language file fails to load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/assets/projects-en-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/projects");

  await expect(page.getByRole("alert")).toContainText(
    "Could not load the Projects page language file.",
  );
  await page.unroute("**/assets/projects-en-*.js");
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  expect([...harness.unexpected]).toEqual([]);
});
