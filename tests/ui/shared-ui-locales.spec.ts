import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test("English command search supports empty results, keyboard navigation, and focus restoration", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.goto("/projects");
  const opener = page.getByRole("button", {
    name: "Open search and command palette",
  });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  const search = dialog.getByRole("combobox", {
    name: "Search pages or experts",
  });
  await expect(search).toBeFocused();
  await search.fill("no-such-expert-734");
  await expect(dialog.getByText("No results found.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press("Control+k");
  await search.fill("New project");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Bring in your idea. Build it together with your team.",
    }),
  ).toBeVisible();
  await expect(page).toHaveTitle("New project — Agentic Company OS");
  expect([...harness.unexpected]).toEqual([]);
});

test("Arabic command search keeps the close action and results inside a short phone viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 560 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "المشاريع", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  const search = dialog.getByRole("combobox", { name: "ابحث عن صفحة أو خبير" });
  await expect(search).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const close = dialog.getByRole("button", { name: "إغلاق", exact: true });
  await expect
    .poll(async () => (await close.boundingBox())?.width)
    .toBeGreaterThanOrEqual(44);
  await expect
    .poll(async () => (await close.boundingBox())?.height)
    .toBeGreaterThanOrEqual(44);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(560);
  await page.screenshot({
    path: testInfo.outputPath("arabic-command-search.png"),
    animations: "disabled",
  });
  await search.fill("unknown-expert-734");
  await expect(dialog.getByText("لم يتم العثور على نتائج.")).toBeVisible();
  await search.fill("");
  await page.setViewportSize({ width: 320, height: 280 });
  await search.press("End");
  const lastResult = dialog.getByRole("option").last();
  await expect(lastResult).toHaveAttribute("aria-selected", "true");
  await expect(lastResult).toBeInViewport();
  await expect(close).toBeInViewport();
  await close.click();
  await expect(dialog).toBeHidden();
  expect([...harness.unexpected]).toEqual([]);
});

test("Arabic phone navigation opens from the right, traps focus, and keeps theme controls usable", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 560 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/projects");
  const opener = page.getByRole("button", {
    name: "افتح القائمة",
    exact: true,
  });
  const sidebar = page.locator("#app-navigation");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  expect(
    await sidebar.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");
  await opener.click();
  await expect(
    sidebar.getByRole("link", { name: "الرئيسية", exact: true }).first(),
  ).toBeFocused();
  await expect
    .poll(async () => {
      const bounds = await sidebar.boundingBox();
      return bounds ? bounds.x + bounds.width : null;
    })
    .toBeCloseTo(320, 0);
  expect((await sidebar.boundingBox())!.x).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await expect(
    sidebar.getByRole("navigation", { name: "القائمة الرئيسية" }),
  ).toBeVisible();
  const theme = sidebar.getByRole("button", {
    name: "التبديل إلى المظهر الداكن",
  });
  expect((await theme.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  expect((await theme.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Shift+Tab");
  await expect(theme).toBeFocused();
  await theme.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: testInfo.outputPath("arabic-phone-navigation.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect([...harness.unexpected]).toEqual([]);
});

test("English sign out preserves access after a failed request and can be retried", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      json: { enabled: true, authenticated: true, sessionExpiresAt: null },
    }),
  );
  let attempts = 0;
  await page.route("**/api/auth/session", (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "Sunucu hatası" } })
      : route.fulfill({ status: 204 });
  });
  await page.goto("/projects");
  const signOut = page.getByRole("button", {
    name: "Sign out of the secure session",
  });
  await signOut.click();
  await expect(
    page.getByText("Could not sign out", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your session may still be open. Try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  const notifications = page.getByRole("region", { name: "Notifications" });
  await notifications
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await signOut.click();
  await expect(
    page.getByRole("heading", { name: "Access AgenticOS" }),
  ).toBeVisible();
  expect(attempts).toBe(2);
  expect([...harness.unexpected]).toEqual([]);
});
