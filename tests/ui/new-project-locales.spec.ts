import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

function watchNewProjectLanguageChunks(page: Page): string[] {
  const requested: string[] = [];
  page.on("request", (request) => {
    const name = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    if (/^new-project-(?:tr|en|de|ru|zh-CN|zh-TW|ar)-[^/]+\.js$/u.test(name)) {
      requested.push(name);
    }
  });
  return requested;
}

test("English new-project form validates in place and keeps the draft after a failed request", async ({
  page,
}) => {
  const localeChunks = watchNewProjectLanguageChunks(page);
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/projects/new");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Bring in your idea. Build it together with your team.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect a model" }),
  ).toBeVisible();
  const name = page.getByRole("textbox", { name: "Project name" });
  const brief = page.getByRole("textbox", { name: "Goal and scope" });
  await page.getByRole("button", { name: "Start project" }).click();
  await expect(name).toBeFocused();
  await expect(page.getByRole("alert")).toContainText(
    "Enter a project name and the outcome you want.",
  );

  await name.fill("Accessible booking site");
  await page.getByRole("button", { name: "Start project" }).click();
  await expect(brief).toBeFocused();
  await brief.fill(
    "Build a booking flow with clear availability and error recovery.",
  );
  await page
    .getByRole("radiogroup", { name: "Project type" })
    .getByRole("radio", { name: "Ongoing" })
    .click();
  await page
    .getByRole("combobox", { name: "Work cadence" })
    .selectOption("900");
  await page
    .getByRole("radiogroup", { name: "Project priority" })
    .getByRole("radio", { name: "High" })
    .click();
  await page.getByRole("button", { name: "Start project" }).click();

  await expect(
    page.getByText(
      "The response was not confirmed. Check this saved request before starting another project.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(name).toHaveValue("Accessible booking site");
  await expect(brief).toHaveValue(
    "Build a booking flow with clear availability and error recovery.",
  );
  expect(harness.requests).toHaveLength(1);
  expect(harness.requests[0].body).toMatchObject({
    title: "Accessible booking site",
    brief: "Build a booking flow with clear availability and error recovery.",
    autonomyMode: "continuous",
    cadenceSeconds: 900,
    priority: "high",
  });
  expect([...harness.unexpected]).toEqual([]);
  expect(localeChunks).toHaveLength(1);
  expect(localeChunks[0]).toMatch(/^new-project-en-/u);
});

test("Arabic new-project form keeps its controls and keyboard order usable on a phone", async ({
  page,
}) => {
  const localeChunks = watchNewProjectLanguageChunks(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/projects/new");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "اطرح فكرتك. حققها مع فريقك.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "العودة إلى المشاريع" }),
  ).toHaveAttribute("href", "/projects");
  await expect(
    page.getByRole("textbox", { name: "اسم المشروع" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "الهدف والنطاق" }),
  ).toBeVisible();
  const team = page.getByLabel("فريق المشروع: 14 من الخبراء النشطين");
  await expect(team.locator('[role="img"]:visible')).toHaveCount(6);
  await expect(team.getByText("+8")).toBeVisible();
  const type = page.getByRole("radiogroup", { name: "نوع المشروع" });
  await type.getByRole("radio", { name: "موجّه للتسليم" }).press("ArrowLeft");
  await expect(type.getByRole("radio", { name: "مستمر" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await type.getByRole("radio", { name: "مستمر" }).press("ArrowRight");
  await expect(
    type.getByRole("radio", { name: "موجّه للتسليم" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect([...harness.unexpected]).toEqual([]);
  expect(localeChunks).toHaveLength(1);
  expect(localeChunks[0]).toMatch(/^new-project-ar-/u);
});

test("New project recovers after its language file fails to load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/assets/new-project-en-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/projects/new");

  await expect(page.getByRole("alert")).toContainText(
    "Could not load the New project page language file.",
  );
  await page.unroute("**/assets/new-project-en-*.js");
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Bring in your idea. Build it together with your team.",
    }),
  ).toBeVisible();
  expect([...harness.unexpected]).toEqual([]);
});

test("New project explains an empty team before it allows work to start", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/api/agents?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.goto("/projects/new");

  await expect(
    page.getByText("Activate at least one expert before starting the project."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start project" }),
  ).toBeDisabled();
  expect(harness.requests).toHaveLength(0);
  expect([...harness.unexpected]).toEqual([]);
});
