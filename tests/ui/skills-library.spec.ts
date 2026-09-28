import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import { WORKSPACE_LOCALES } from "../../artifacts/api-server/src/lib/workspace-locale";

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale} phone library searches real skills and hands off a reviewable draft`, async ({
    page,
  }) => {
    const catalog = getCapabilityCatalog(locale);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript(
      (language) => localStorage.setItem("acos.locale.v1", language),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/skills?*", (route) =>
      route.fulfill({ json: catalog }),
    );
    await page.goto("/skills");
    await expect(
      page.getByRole("heading", { level: 1, name: catalog.copy.title }),
    ).toBeVisible();
    await expect(page.locator("[data-skill-id]")).toHaveCount(30);
    await page
      .getByRole("searchbox", { name: catalog.copy.search })
      .fill(" CSV-QUALITY ");
    await expect(page.locator("[data-skill-id]")).toHaveCount(1);
    const skill = page.locator('[data-skill-id="csv-quality"]');
    await skill.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(
      skill.getByText(catalog.copy.files, { exact: true }),
    ).toBeVisible();
    await expect(
      skill.getByText(catalog.skills[12].steps[0], { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`skills-${locale}.png`),
      fullPage: true,
    });
    await skill.getByRole("button", { name: catalog.copy.use }).click();
    await expect(page).toHaveURL(/\/projects\/new$/u);
    await expect(page.locator("input#title")).toHaveValue(
      catalog.skills[12].title,
    );
    await expect(page.locator("textarea#brief")).toHaveValue(
      new RegExp(
        catalog.skills[12].deliverable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      ),
    );
    expect(harness.requests).toHaveLength(0);
    await page.locator("textarea#brief").fill("My reviewed scope 原文");
    await expect(page.locator("textarea#brief")).toHaveValue(
      "My reviewed scope 原文",
    );
    expect([...harness.unexpected]).toEqual([]);
  });
}

test("library recovers from loading and errors and shows an empty search without starting work", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let fail = true;
  await page.route("**/api/skills?*", async (route) => {
    if (fail)
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    return route.fulfill({ json: getCapabilityCatalog("en") });
  });
  await page.goto("/skills");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  fail = false;
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.locator("[data-skill-id]")).toHaveCount(30);
  await page
    .getByRole("searchbox", { name: "Search skills" })
    .fill("no-such-result");
  await expect(
    page.getByRole("status").filter({ hasText: "No skills" }),
  ).toBeVisible();
  expect(harness.requests).toHaveLength(0);
});

test("light desktop library shows loading and filters by area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/skills?*", async (route) => {
    await gate;
    return route.fulfill({ json: getCapabilityCatalog("en") });
  });
  await page.goto("/skills");
  // Wait for this route, rather than accepting its earlier Suspense loader.
  // The independent emergency-stop status can also be loading at this point.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Skills & tools",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: /^Loading page$/ }),
  ).toBeVisible();
  release();
  await expect(page.locator("[data-skill-id]")).toHaveCount(30);
  await page
    .getByRole("combobox", { name: "All areas" })
    .selectOption("engineering");
  await expect(page.locator("[data-skill-id]")).toHaveCount(6);
  await page
    .getByRole("searchbox", { name: "Search skills" })
    .fill("code-review");
  const row = page.locator('[data-skill-id="code-review"]');
  await row.locator("summary").click();
  await expect(
    row.getByRole("button", { name: "Create project draft" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("skills-desktop-light.png"),
    fullPage: true,
  });
  expect(harness.requests).toHaveLength(0);
});
