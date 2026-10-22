import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { waitForNativePageReady } from "../../scripts/src/testing/native-page-readiness";

test.use({ storageState: { cookies: [], origins: [] } });

test("native first-page readiness accepts a delayed authenticated bootstrap", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.addInitScript(() =>
    localStorage.setItem("acos.locale.v1", "zh-CN"),
  );
  await page.route("**/api/auth/status", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6500));
    await route.fulfill({
      status: 200,
      json: { enabled: false, authenticated: true, sessionExpiresAt: null },
    });
  });
  await page.goto("/");
  const draft = page.getByRole("textbox", {
    name: "你想要的成果",
    exact: true,
  });
  await waitForNativePageReady(draft);
  await expect(draft).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(pageErrors).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
  expect(
    harness.requests.filter((row) => row.path.startsWith("/api/tasks")),
  ).toEqual([]);
});

test("native first-page readiness rejects a bootstrap that never finishes", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const harness = await installStudioFixtures(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.addInitScript(() =>
    localStorage.setItem("acos.locale.v1", "zh-CN"),
  );
  await page.route("**/api/auth/status", async (route) => {
    await pending;
    await route
      .fulfill({
        status: 200,
        json: { enabled: false, authenticated: true, sessionExpiresAt: null },
      })
      .catch(() => {});
  });
  try {
    await page.goto("/");
    await expect(
      waitForNativePageReady(
        page.getByRole("textbox", { name: "你想要的成果", exact: true }),
      ),
    ).rejects.toThrow(/Timeout:\s*30000ms/u);
    expect(
      harness.requests.filter((row) => row.path.startsWith("/api/tasks")),
    ).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  } finally {
    release();
  }
});

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
