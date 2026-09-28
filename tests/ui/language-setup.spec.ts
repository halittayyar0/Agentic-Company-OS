import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("first run can choose Arabic and restore the RTL choice", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  let syncedLocale: string | null = null;
  await page.route("**/api/settings/locale", async (route) => {
    const payload = route.request().postDataJSON() as { locale: string };
    syncedLocale = payload.locale;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      }),
    }),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dilini seç" })).toBeVisible();
  await page.getByRole("radio", { name: /العربية/ }).click();
  await expect(page.getByRole("heading", { name: "اختر لغتك" })).toBeVisible();
  await expect(
    page.getByText(
      "الترجمات بانتظار المراجعة. تبقى نصوصك والسجلات السابقة بلغتها الأصلية.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect.poll(() => syncedLocale).toBe("ar");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("acos.locale.v1")))
    .toBe("ar");

  await page.reload();
  await expect(page.getByRole("heading", { name: "اختر لغتك" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(
    page.getByRole("heading", { name: "ما الذي سننجزه معًا اليوم؟" }),
  ).toBeVisible();
  expect([...harness.unexpected]).toEqual([]);
});

test("keyboard selection reaches Traditional Chinese", async ({ page }) => {
  await page.goto("/");
  const selected = page.getByRole("radio", { name: /Türkçe/ });
  await selected.focus();
  await selected.press("End");
  await expect(page.getByRole("radio", { name: /العربية/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("radio", { name: /العربية/ }).press("ArrowUp");
  await expect(page.getByRole("radio", { name: /繁體中文/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
