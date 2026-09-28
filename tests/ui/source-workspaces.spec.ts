import { test, expect } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
const locales = {
  tr: "Kaynak kodunu geliştir",
  en: "Improve source code",
  de: "Quellcode verbessern",
  ru: "Улучшить исходный код",
  "zh-CN": "改进源代码",
  "zh-TW": "改進原始碼",
  ar: "تحسين الشيفرة المصدرية",
};
for (const [locale, title] of Object.entries(locales)) {
  test(`source workspace controls are readable on mobile in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    await installStudioFixtures(page);
    await page.route("**/api/source-changes", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.goto("/settings");
    await page.getByText(title, { exact: true }).click();
    const panel = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: title }) })
      .first();
    await expect(panel.locator("input")).toBeVisible();
    await expect(panel.locator("textarea")).toBeVisible();
    await expect(panel.locator("button[type=submit]")).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (locale === "ar")
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
}
test("checked source version is explicitly applied once and its outcome remains visible", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  let calls = 0;
  const row = {
    id: "53c7e7af-5448-4351-8116-e14795711608",
    agentId: 1,
    sourcePath: "/workspace/project",
    request: "Update the welcome page",
    state: "verified",
    revision: 4,
    baseCommit: "a".repeat(40),
    candidateCommit: "b".repeat(40),
    error: null,
    check: {
      command: ["node", "--check", "page.mjs"],
      output: "check passed",
      passed: true,
    },
    diff: "+ Welcome",
  };
  await page.route("**/api/source-changes**", async (route) => {
    if (route.request().url().endsWith("/apply")) {
      calls++;
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 4 });
      row.state = "applied";
      row.revision++;
      return route.fulfill({ json: row });
    }
    return route.fulfill({
      json: route.request().url().endsWith("/source-changes") ? [row] : row,
    });
  });
  await page.goto("/settings");
  await page.getByText("Improve source code", { exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByText("+ Welcome", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Apply checked version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Roll back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply checked version", exact: true }),
  ).toHaveCount(0);
  expect(calls).toBe(1);
});
